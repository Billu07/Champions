import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
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

export async function POST(request: Request) {
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

  for (const route of parsed.data.reviewedRoutes) {
    const routeMessage = route.message.trim() || parsed.data.finalMessage;

    for (const employeeId of dedupe(route.recipientEmployeeIds)) {
      const employee = recipientsById.get(employeeId);
      if (!employee) continue;

      try {
        const response = await sendDynamicTemplateMessage({
          toE164: employee.whatsapp_e164,
          templateName: env.WHATSAPP_BROADCAST_TEMPLATE_NAME,
          languageCode: "en",
          bodyParameters: [
            {
              type: "text",
              parameterName: "body",
              text: routeMessage.slice(0, 1000),
            },
          ],
        });

        await insertBroadcastDelivery({
          campaignId,
          employeeId: employee.id,
          whatsappMessageId: response.id,
          status: "accepted",
          statusPayload: {
            routeId: route.routeId,
            routeSource: route.source,
            targetLabel: route.targetLabel,
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
          },
          messageText: routeMessage,
        });

        accepted += 1;
      } catch (error) {
        await insertBroadcastDelivery({
          campaignId,
          employeeId: employee.id,
          status: "failed",
          failureReason: (error as Error).message,
          statusPayload: {
            routeId: route.routeId,
            routeSource: route.source,
            targetLabel: route.targetLabel,
          },
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
  });
}
