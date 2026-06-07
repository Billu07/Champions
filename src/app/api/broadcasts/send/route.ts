import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
import { mapWithConcurrency } from "@/lib/concurrency";
import { logError } from "@/lib/logger";
import {
  createBroadcastCampaign,
  getEmployeesByIds,
  getEmployeesWithOpenServiceWindow,
  insertBroadcastDelivery,
  insertMessageEvent,
} from "@/lib/repository";
import { sendDynamicTemplateMessage, sendTextMessage } from "@/lib/whatsapp";
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
      `^${escaped}(?:\\s*(?:[,:;.!?\\u2013\\u2014\\u0964-])\\s*|\\s+)`,
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
  const preferred = env.WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE.trim() || "en";
  const normalized = preferred.toLowerCase();
  const fallbacks = normalized.startsWith("bn")
    ? ["bn", "bn_BD", "en", "en_US"]
    : ["en", "en_US"];
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

type FailureOwner = "meta_compliance" | "meta_template" | "recipient_data" | "environment" | "unknown";
type FailureCategory =
  | "template_translation_missing"
  | "template_parameter_mismatch"
  | "meta_policy_block"
  | "recipient_undeliverable"
  | "recipient_experiment_gate"
  | "allowlist_block"
  | "auth_or_permission"
  | "rate_limit"
  | "network_or_timeout"
  | "unknown";

type ClassifiedFailure = {
  category: FailureCategory;
  owner: FailureOwner;
  label: string;
  hint: string;
};

function classifyFailureReason(reason: string): ClassifiedFailure {
  const normalized = reason.toLowerCase();

  if (
    normalized.includes("132001") ||
    normalized.includes("translation") ||
    normalized.includes("template name does not exist")
  ) {
    return {
      category: "template_translation_missing",
      owner: "meta_template",
      label: "Template language translation missing",
      hint: "Meta template is not approved/published for attempted language code.",
    };
  }

  if (isTemplateParameterError(new Error(reason))) {
    return {
      category: "template_parameter_mismatch",
      owner: "meta_template",
      label: "Template parameter mismatch",
      hint: "Template variables in Meta do not match payload mapping.",
    };
  }

  if (normalized.includes("healthy ecosystem engagement") || normalized.includes("131047") || normalized.includes("470")) {
    return {
      category: "meta_policy_block",
      owner: "meta_compliance",
      label: "Meta policy/compliance throttle",
      hint: "Meta blocked this delivery due policy, quality, or conversation rules.",
    };
  }

  if (normalized.includes("part of an experiment")) {
    return {
      category: "recipient_experiment_gate",
      owner: "meta_compliance",
      label: "Meta experiment gate",
      hint: "Meta currently limits this recipient number as part of platform experiments.",
    };
  }

  if (normalized.includes("message undeliverable")) {
    return {
      category: "recipient_undeliverable",
      owner: "recipient_data",
      label: "Recipient number undeliverable",
      hint: "Recipient number is unavailable/unreachable on WhatsApp.",
    };
  }

  if (normalized.includes("blocked by whatsapp_test_allowlist_e164")) {
    return {
      category: "allowlist_block",
      owner: "environment",
      label: "Blocked by test allowlist",
      hint: "Number is not present in WHATSAPP_TEST_ALLOWLIST_E164.",
    };
  }

  if (normalized.includes("401") || normalized.includes("unauthorized") || normalized.includes("permission")) {
    return {
      category: "auth_or_permission",
      owner: "environment",
      label: "Authentication/permission issue",
      hint: "Access token, app permission, or business capability is invalid.",
    };
  }

  if (normalized.includes("429") || normalized.includes("rate limit")) {
    return {
      category: "rate_limit",
      owner: "meta_compliance",
      label: "Rate limited",
      hint: "Too many requests/messages in a short time window.",
    };
  }

  if (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("fetch failed") ||
    normalized.includes("network")
  ) {
    return {
      category: "network_or_timeout",
      owner: "unknown",
      label: "Network/timeout issue",
      hint: "Transient connectivity issue while calling WhatsApp API.",
    };
  }

  return {
    category: "unknown",
    owner: "unknown",
    label: "Unknown delivery error",
    hint: "Inspect the failure reason and WhatsApp payload for details.",
  };
}

function failurePriority(error: unknown): number {
  const message = (error as Error).message ?? "";
  const normalized = message.toLowerCase();

  if (isTemplateParameterError(error)) return 500;
  if (normalized.includes("132001")) return 300;
  if (normalized.includes("blocked by whatsapp_test_allowlist_e164")) return 400;
  if (normalized.includes("401") || normalized.includes("unauthorized")) return 450;
  return 200;
}

function pickPreferredError(current: Error | null, candidate: Error): Error {
  if (!current) return candidate;
  return failurePriority(candidate) >= failurePriority(current) ? candidate : current;
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

// Max recipients sent in parallel. WhatsApp Cloud API (STANDARD tier) tolerates
// far higher, but a bounded pool keeps memory/DB load predictable.
const SEND_CONCURRENCY = 8;

type TemplateCombo = { variantName: string; languageCode: string };

type SendTask = {
  route: z.infer<typeof routeSchema>;
  employee: Awaited<ReturnType<typeof getEmployeesByIds>>[number];
  message: string;
};

// Once one recipient succeeds, reuse that (variant, language) first for everyone
// else so we skip re-walking the whole fallback ladder per recipient.
function variantsForCombo(
  employeeName: string,
  message: string,
  preferred: TemplateCombo | null,
): ReturnType<typeof parameterVariants> {
  const variants = parameterVariants(employeeName, message);
  if (!preferred) return variants;
  const idx = variants.findIndex((variant) => variant.name === preferred.variantName);
  if (idx <= 0) return variants;
  return [variants[idx], ...variants.slice(0, idx), ...variants.slice(idx + 1)];
}

function languagesForCombo(languages: string[], preferred: TemplateCombo | null): string[] {
  if (!preferred) return languages;
  const idx = languages.indexOf(preferred.languageCode);
  if (idx <= 0) return languages;
  return [languages[idx], ...languages.slice(0, idx), ...languages.slice(idx + 1)];
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

    // Recipients who messaged us in the last 24h can receive free-form text
    // (instant, no template, no marketing frequency cap / 131049).
    const openWindow = await getEmployeesWithOpenServiceWindow(recipientIds);

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
    const failureSummary = new Map<
      FailureCategory,
      ClassifiedFailure & { count: number }
    >();

    // Flatten routes → recipients into a single task list so we can fan out.
    const tasks: SendTask[] = [];
    for (const route of parsed.data.reviewedRoutes) {
      const routeMessage = route.message.trim() || parsed.data.finalMessage;
      for (const employeeId of dedupe(route.recipientEmployeeIds)) {
        const employee = recipientsById.get(employeeId);
        if (!employee) continue;
        const recipientNames = candidateNamesForEmployee(employee.full_name, employee.aliases ?? []);
        const message = route.source === "ai_person"
          ? (stripLeadingNameMentions(routeMessage, recipientNames) || routeMessage)
          : routeMessage;
        tasks.push({ route, employee, message });
      }
    }

    // Shared across workers; first successful send seeds it so the rest skip the ladder.
    let preferredCombo: TemplateCombo | null = null;

    const recordAccepted = async (
      employee: SendTask["employee"],
      response: { id?: string },
      meta: {
        route: SendTask["route"];
        message: string;
        channel: "free_form" | "template";
        languageCode?: string;
        templateVariant?: string;
      },
    ): Promise<void> => {
      await insertBroadcastDelivery({
        campaignId,
        employeeId: employee.id,
        whatsappMessageId: response.id,
        status: "accepted",
        statusPayload: {
          routeId: meta.route.routeId,
          routeSource: meta.route.source,
          targetLabel: meta.route.targetLabel,
          channel: meta.channel,
          languageCode: meta.languageCode ?? null,
          templateVariant: meta.templateVariant ?? null,
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
          routeId: meta.route.routeId,
          routeSource: meta.route.source,
          routeTargetLabel: meta.route.targetLabel,
          channel: meta.channel,
          template: meta.channel === "template" ? env.WHATSAPP_BROADCAST_TEMPLATE_NAME : null,
          languageCode: meta.languageCode ?? null,
          templateVariant: meta.templateVariant ?? null,
          bodySanitizedForRecipientName: meta.route.source === "ai_person",
        },
        messageText: meta.message,
      });

      accepted += 1;
    };

    const processTask = async ({ route, employee, message }: SendTask): Promise<void> => {
      let attemptedLanguage = "";
      let attemptedTemplateVariant = "";
      try {
        // Free-form fast path inside the 24h service window: instant and uncapped.
        // Any failure (e.g. window just closed) falls through to the template ladder.
        if (openWindow.has(employee.id)) {
          try {
            const freeFormResponse = await sendTextMessage({
              toE164: employee.whatsapp_e164,
              message,
            });
            await recordAccepted(employee, freeFormResponse, { route, message, channel: "free_form" });
            return;
          } catch (error) {
            logError("Broadcast free-form send failed; falling back to template", {
              campaignId,
              employeeId: employee.id,
              error: (error as Error).message,
            });
          }
        }

        let response: { id?: string } | null = null;
        let usedLanguage = "";
        let usedTemplateVariant = "";
        let lastError: Error | null = null;
        let preferredError: Error | null = null;

        const variants = variantsForCombo(employee.full_name, message, preferredCombo);
        const orderedLanguages = languagesForCombo(languages, preferredCombo);

        for (const variant of variants) {
          let variantHadParameterMismatch = false;
          for (const languageCode of orderedLanguages) {
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
              const typedError = error as Error;
              lastError = typedError;
              preferredError = pickPreferredError(preferredError, typedError);

              if (isTemplateParameterError(typedError)) {
                variantHadParameterMismatch = true;
                break;
              }

              if (isTranslationError(typedError)) {
                continue;
              }
              throw typedError;
            }
          }
          if (response) break;
          if (variantHadParameterMismatch) {
            continue;
          }
        }

        if (!response) {
          throw preferredError ?? lastError ?? new Error("Broadcast send failed: no language candidate succeeded");
        }

        if (!preferredCombo) {
          preferredCombo = { variantName: usedTemplateVariant, languageCode: usedLanguage };
        }

        await recordAccepted(employee, response, {
          route,
          message,
          channel: "template",
          languageCode: usedLanguage,
          templateVariant: usedTemplateVariant,
        });
      } catch (error) {
        const reason = (error as Error).message || "Broadcast send failed";
        const classified = classifyFailureReason(reason);
        const existingSummary = failureSummary.get(classified.category);
        failureSummary.set(
          classified.category,
          existingSummary
            ? { ...existingSummary, count: existingSummary.count + 1 }
            : { ...classified, count: 1 },
        );

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
              attemptedLanguage: attemptedLanguage || null,
              attemptedTemplateVariant: attemptedTemplateVariant || null,
              classifiedCategory: classified.category,
              classifiedOwner: classified.owner,
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
    };

    // Send the first recipient alone to discover the working (variant, language),
    // then fan the rest out concurrently reusing that combo.
    if (tasks.length > 0) {
      await processTask(tasks[0]);
      await mapWithConcurrency(tasks.slice(1), SEND_CONCURRENCY, processTask);
    }

    return ok({
      campaignId,
      accepted,
      sent: accepted,
      failed,
      routes: parsed.data.reviewedRoutes.length,
      recipients: recipients.length,
      failureDetails: failureDetails.slice(0, 10),
      failureSummary: Array.from(failureSummary.values()).sort((a, b) => b.count - a.count),
    });
  } catch (error) {
    const message = (error as Error).message || "Broadcast send failed";
    logError("Broadcast send route failed", { error: message });
    return fail(message, 500);
  }
}
