import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
import { logError } from "@/lib/logger";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  getBroadcastCampaignFinalMessage,
  getBroadcastDeliveryBreakdown,
  getEmployeesByIds,
  getEmployeesWithOpenServiceWindow,
  insertBroadcastDelivery,
} from "@/lib/repository";
import { sendDynamicTemplateMessage, sendTextMessage } from "@/lib/whatsapp";

const schema = z.object({ campaignId: z.string().uuid() });
const RETRY_CONCURRENCY = 8;

export async function POST(request: Request) {
  try {
    if (!(await requestHasAdminSession(request))) {
      return fail("Unauthorized", 401);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
    }
    const { campaignId } = parsed.data;

    const message = await getBroadcastCampaignFinalMessage(campaignId);
    if (!message) {
      return fail("Campaign not found or has no message", 404);
    }

    const breakdown = await getBroadcastDeliveryBreakdown(campaignId);
    const undelivered = breakdown.filter((row) => row.status === "accepted" || row.status === "failed");
    if (undelivered.length === 0) {
      return ok({ campaignId, retried: 0, accepted: 0, failed: 0, message: "No undelivered recipients to retry." });
    }

    const ids = undelivered.map((row) => row.employeeId);
    const employees = await getEmployeesByIds(ids);
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    // Recipients who messaged in the last 24h can be retried via free-form (uncapped).
    const openWindow = await getEmployeesWithOpenServiceWindow(ids);

    let accepted = 0;
    let failed = 0;

    await mapWithConcurrency(undelivered, RETRY_CONCURRENCY, async (row) => {
      const employee = byId.get(row.employeeId);
      if (!employee) return;

      try {
        let response: { id?: string };
        let channel: "free_form" | "template";

        if (openWindow.has(employee.id)) {
          response = await sendTextMessage({ toE164: employee.whatsapp_e164, message });
          channel = "free_form";
        } else {
          response = await sendDynamicTemplateMessage({
            toE164: employee.whatsapp_e164,
            templateName: env.WHATSAPP_BROADCAST_TEMPLATE_NAME,
            languageCode: env.WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE,
            bodyParameters: [
              { type: "text", parameterName: "employee_name", text: employee.full_name.slice(0, 120) || "Team Member" },
              { type: "text", parameterName: "body", text: message.slice(0, 1000) },
            ],
          });
          channel = "template";
        }

        await insertBroadcastDelivery({
          campaignId,
          employeeId: employee.id,
          whatsappMessageId: response.id,
          status: "accepted",
          statusPayload: { channel, retry: true },
        });
        accepted += 1;
      } catch (error) {
        const reason = (error as Error).message || "Retry failed";
        try {
          await insertBroadcastDelivery({
            campaignId,
            employeeId: employee.id,
            status: "failed",
            failureReason: reason,
            statusPayload: { channel: "template", retry: true },
          });
        } catch (persistError) {
          logError("Failed to persist broadcast retry failure", {
            campaignId,
            employeeId: employee.id,
            error: (persistError as Error).message,
          });
        }
        failed += 1;
      }
    });

    return ok({ campaignId, retried: undelivered.length, accepted, failed });
  } catch (error) {
    const message = (error as Error).message || "Broadcast retry failed";
    logError("Broadcast retry failed", { error: message });
    return fail(message, 500);
  }
}
