import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
import { logError } from "@/lib/logger";
import {
  createBroadcastCampaign,
  getEmployeesByIds,
  insertBroadcastDelivery,
  insertMessageEvent,
} from "@/lib/repository";
import { sendDynamicTemplateMessage } from "@/lib/whatsapp";
import type { BroadcastSendRequest } from "@/lib/types";

const routeSchema = z.object({
  routeId: z.string().min(1),
  targetLabel: z.string().min(1),
  source: z.enum(["manual", "tag", "mention", "ai_group", "ai_person", "mixed"]),
  recipientEmployeeIds: z.array(z.string().uuid()).default([]),
  message: z.string().min(1),
});

const schema = z.object({
  originalMessage: z.string().min(1),
  finalMessage: z.string().min(1),
  audienceCategory: z.enum(["sales_team", "head_office", "drivers", "customers", "all", "custom"]),
  reviewedRoutes: z.array(routeSchema).min(1),
  allowEmptyRecipients: z.boolean().optional().default(false),
});

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidateNamesForEmployee(fullName: string, aliases: string[] = []): string[] {
  const base = fullName.trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const short = parts.length > 1 ? parts[parts.length - 1] : "";

  return dedupe([base, ...aliases.map((item) => item.trim()), short])
    .filter((item) => item.length >= 2)
    .sort((a, b) => b.length - a.length);
}

function stripLeadingNameMentions(message: string, names: string[]): string {
  let text = message.trim();
  if (!text) return "";

  for (const name of names) {
    const escaped = escapeRegExp(name);
    const pattern = new RegExp(
      `^${escaped}(?:\\s*(?:[,:;.!?\\-\\u2013\\u2014\\u0964])\\s*|\\s+)`,
      "iu",
    );

    if (pattern.test(text)) {
      text = text.replace(pattern, "").trim();
      break;
    }
  }

  return text;
}

function languageCandidates(): string[] {
  const preferred = env.WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE.trim();
  const fallbacks = ["en_US", "en", "bn", "bn_BD"];
  return Array.from(new Set([preferred, ...fallbacks].map((item) => item.trim()).filter(Boolean)));
}

function isTranslationError(error: unknown): boolean {
  const message = (error as Error).message ?? "";
  const normalized = message.toLowerCase();
  return normalized.includes("132001") || normalized.includes("does not exist in the translation");
}

function isTemplateParameterError(error: unknown): boolean {
  const message = (error as Error).message ?? "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("132018") ||
    normalized.includes("132000") ||
    normalized.includes("issue with the parameters in your template") ||
    normalized.includes("parameter at index") ||
    normalized.includes("localizable_params") ||
    normalized.includes("number of parameters") ||
    normalized.includes("required parameter")
  );
}

function parameterVariants(employeeName: string, message: string) {
  const safeEmployeeName = employeeName.trim().slice(0, 120) || "Team Member";
  const safeBody = message.slice(0, 1000);
  const compactBody = safeBody.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  return [
    {
      name: "named_employee_name+body",
      bodyParameters: [
        { type: "text" as const, parameterName: "employee_name", text: safeEmployeeName },
        { type: "text" as const, parameterName: "body", text: safeBody },
      ],
    },
    {
      name: "named_body_only",
      bodyParameters: [{ type: "text" as const, parameterName: "body", text: safeBody }],
    },
    {
      name: "positional_employee_name+body",
      bodyParameters: [
        { type: "text" as const, text: safeEmployeeName },
        { type: "text" as const, text: safeBody },
      ],
    },
    {
      name: "positional_body_only",
      bodyParameters: [{ type: "text" as const, text: safeBody }],
    },
    {
      name: "positional_body_compact",
      bodyParameters: [{ type: "text" as const, text: compactBody || safeBody }],
    },
  ];
}

export async function POST(request: Request) {
  try {
    if (!(await requestHasAdminSession(request))) {
      return fail("Unauthorized", 401);
    }

    const body = (await request.json().catch(() => ({}))) as BroadcastSendRequest;
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
    }

    const recipientIds = dedupe(parsed.data.reviewedRoutes.flatMap((route) => route.recipientEmployeeIds));
    if (recipientIds.length === 0 && !parsed.data.allowEmptyRecipients) {
      return fail("No recipients selected in reviewed routes", 400);
    }

    const recipients = await getEmployeesByIds(recipientIds);
    const recipientsById = new Map(recipients.map((employee) => [employee.id, employee]));

    const campaignId = await createBroadcastCampaign({
      creatorType: "ceo",
      originalMessage: parsed.data.originalMessage,
      finalMessage: parsed.data.finalMessage,
      audienceType: parsed.data.audienceCategory,
      recipientCount: recipients.length,
    });

    let accepted = 0;
    let failed = 0;
    const languages = languageCandidates();
    const failureDetails: Array<{ employeeName: string; reason: string; languageCode: string; templateVariant: string }> = [];

    for (const route of parsed.data.reviewedRoutes) {
      const routeMessage = route.message.trim() || parsed.data.finalMessage;

      for (const employeeId of dedupe(route.recipientEmployeeIds)) {
        const employee = recipientsById.get(employeeId);
        if (!employee) continue;
        const recipientNames = candidateNamesForEmployee(employee.full_name, employee.aliases ?? []);
        const personalizedRouteMessage = route.source === "ai_person"
          ? (stripLeadingNameMentions(routeMessage, recipientNames) || routeMessage)
          : routeMessage;

        let attemptedLanguage = "";
        let attemptedTemplateVariant = "";
        try {
          let response: { id?: string } | null = null;
          let usedLanguage = "";
          let usedTemplateVariant = "";
          let lastError: Error | null = null;

          for (const variant of parameterVariants(employee.full_name, personalizedRouteMessage)) {
            for (const languageCode of languages) {
              attemptedLanguage = languageCode;
              attemptedTemplateVariant = variant.name;
              try {
                response = await sendDynamicTemplateMessage({
                  toE164: employee.whatsapp_e164,
                  templateName: env.WHATSAPP_BROADCAST_TEMPLATE_NAME,
                  languageCode,
                  bodyParameters: variant.bodyParameters,
                });
                usedLanguage = languageCode;
                usedTemplateVariant = variant.name;
                break;
              } catch (error) {
                lastError = error as Error;
                if (isTranslationError(error) || isTemplateParameterError(error)) {
                  continue;
                }
                throw error;
              }
            }
            if (response) break;
          }

          if (!response) {
            throw lastError ?? new Error("Broadcast send failed: no language candidate succeeded");
          }

          await insertBroadcastDelivery({
            campaignId,
            employeeId: employee.id,
            whatsappMessageId: response.id,
            status: "accepted",
            statusPayload: {
              routeId: route.routeId,
              routeSource: route.source,
              targetLabel: route.targetLabel,
              languageCode: usedLanguage,
              templateVariant: usedTemplateVariant,
            },
          });

          await insertMessageEvent({
            employeeId: employee.id,
            direction: "outbound",
            category: "ceo_broadcast_template",
            whatsappMessageId: response.id ?? null,
            payload: {
              campaignId,
              audienceCategory: parsed.data.audienceCategory,
              routeId: route.routeId,
              routeSource: route.source,
              routeTargetLabel: route.targetLabel,
              template: env.WHATSAPP_BROADCAST_TEMPLATE_NAME,
              languageCode: usedLanguage,
              templateVariant: usedTemplateVariant,
              bodySanitizedForRecipientName: route.source === "ai_person",
            },
            messageText: personalizedRouteMessage,
          });

          accepted += 1;
        } catch (error) {
          const reason = (error as Error).message || "Broadcast send failed";
          try {
            await insertBroadcastDelivery({
              campaignId,
              employeeId: employee.id,
              status: "failed",
              failureReason: reason,
              statusPayload: {
                routeId: route.routeId,
                routeSource: route.source,
                targetLabel: route.targetLabel,
              },
            });
          } catch (deliveryError) {
            logError("Failed to persist broadcast delivery failure", {
              campaignId,
              employeeId: employee.id,
              originalReason: reason,
              insertError: (deliveryError as Error).message,
            });
          }

          failureDetails.push({
            employeeName: employee.full_name,
            reason,
            languageCode: attemptedLanguage || env.WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE,
            templateVariant: attemptedTemplateVariant || "unknown",
          });
          failed += 1;
        }
      }
    }

    return ok({
      campaignId,
      accepted,
      sent: accepted,
      failed,
      routes: parsed.data.reviewedRoutes.length,
      recipients: recipients.length,
      failureDetails: failureDetails.slice(0, 10),
    });
  } catch (error) {
    const message = (error as Error).message || "Broadcast send failed";
    logError("Broadcast send route failed", { error: message });
    return fail(message, 500);
  }
}
