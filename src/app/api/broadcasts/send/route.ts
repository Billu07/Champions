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
import { sendDynamicTemplateMessage, sendTextMessage } from "@/lib/whatsapp";

const schema = z.object({
  originalMessage: z.string().min(1),
  finalMessage: z.string().min(1),
  recipientEmployeeIds: z.array(z.string().uuid()).min(1),
  audienceType: z.enum(["manual", "tag", "mention", "mixed"]),
});

async function sendWithTemplateFirstPolicy(toE164: string, finalMessage: string) {
  try {
    const freeform = await sendTextMessage({ toE164, message: finalMessage });
    return { mode: "freeform" as const, id: freeform.id ?? null };
  } catch (error) {
    const message = (error as Error).message.toLowerCase();
    const requiresTemplate =
      message.includes("24") ||
      message.includes("outside") ||
      message.includes("window") ||
      message.includes("policy");

    if (!requiresTemplate) {
      throw error;
    }

    const templated = await sendDynamicTemplateMessage({
      toE164,
      templateName: env.WHATSAPP_BROADCAST_TEMPLATE_NAME,
      languageCode: "en",
      bodyParameters: [{ type: "text", parameterName: "body", text: finalMessage.slice(0, 1000) }],
    });

    return { mode: "template_fallback" as const, id: templated.id ?? null };
  }
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  const recipients = await getEmployeesByIds(parsed.data.recipientEmployeeIds);

  const campaignId = await createBroadcastCampaign({
    creatorType: "ceo",
    originalMessage: parsed.data.originalMessage,
    finalMessage: parsed.data.finalMessage,
    audienceType: parsed.data.audienceType,
    recipientCount: recipients.length,
  });

  let sent = 0;
  let failed = 0;

  for (const employee of recipients) {
    try {
      const delivery = await sendWithTemplateFirstPolicy(employee.whatsapp_e164, parsed.data.finalMessage);

      await insertBroadcastDelivery({
        campaignId,
        employeeId: employee.id,
        whatsappMessageId: delivery.id,
        status: "sent",
      });

      await insertMessageEvent({
        employeeId: employee.id,
        direction: "outbound",
        category: `ceo_broadcast_${delivery.mode}`,
        whatsappMessageId: delivery.id,
        payload: {
          campaignId,
          audienceType: parsed.data.audienceType,
          deliveryMode: delivery.mode,
        },
        messageText: parsed.data.finalMessage,
      });

      sent += 1;
    } catch (error) {
      await insertBroadcastDelivery({
        campaignId,
        employeeId: employee.id,
        status: "failed",
        failureReason: (error as Error).message,
      });
      failed += 1;
    }
  }

  return ok({
    campaignId,
    sent,
    failed,
    recipients: recipients.length,
  });
}
