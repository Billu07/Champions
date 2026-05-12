import { subDays } from "date-fns";
import { env } from "@/lib/config";
import { WORKING_DAYS } from "@/lib/constants";
import { logError, logInfo } from "@/lib/logger";
import { dhakaDateISO, dhakaDayName, slotForTimestamp } from "@/lib/time";
import type { SlotKey, WhatsAppInboundMessage } from "@/lib/types";
import {
  completeJobRun,
  createJobRun,
  findEmployeeByWhatsAppFrom,
  getTemplateBySlot,
  getTrackedEmployees,
  insertMessageEvent,
  markMissingForSlot,
  mergeSlotResponse,
} from "@/lib/repository";
import { scheduledBodyParameters } from "@/lib/scheduled-template";
import { sendDynamicTemplateMessage } from "@/lib/whatsapp";
import { filterAllowedEmployees, isWhatsAppTestAllowlistEnabled } from "@/lib/whatsapp-test-allowlist";

function isWorkingDay(date: Date): boolean {
  const name = dhakaDayName(date, env.NEXT_PUBLIC_APP_TIMEZONE);
  return WORKING_DAYS.includes(name);
}

function previousSlot(slot: SlotKey): { slot: SlotKey; dateOffsetDays: number } {
  if (slot === "morning") return { slot: "evening", dateOffsetDays: -1 };
  if (slot === "noon") return { slot: "morning", dateOffsetDays: 0 };
  if (slot === "afternoon") return { slot: "noon", dateOffsetDays: 0 };
  return { slot: "afternoon", dateOffsetDays: 0 };
}

function formatInboundFragment(message: WhatsAppInboundMessage): string {
  const text = message.text?.body?.trim() ?? "";
  if (message.type === "location" && message.location) {
    const lat = message.location.latitude ?? "";
    const lng = message.location.longitude ?? "";
    const address = message.location.address ? ` | ${message.location.address}` : "";
    const locationText = `Location: ${lat}, ${lng}${address}`;
    return text ? `${text}\n${locationText}` : locationText;
  }

  return text || "[non-text reply]";
}

function extractMessages(payload: Record<string, unknown>): WhatsAppInboundMessage[] {
  if (Array.isArray(payload.messages)) {
    return payload.messages as WhatsAppInboundMessage[];
  }

  const entry = Array.isArray(payload.entry) ? payload.entry : [];
  const messages: WhatsAppInboundMessage[] = [];

  for (const item of entry as Array<{ changes?: Array<{ value?: { messages?: WhatsAppInboundMessage[] } }> }>) {
    const changes = item.changes ?? [];
    for (const change of changes) {
      for (const msg of change.value?.messages ?? []) {
        messages.push(msg);
      }
    }
  }

  return messages;
}

export async function runScheduledSlot(slot: SlotKey, now = new Date()) {
  const trackingDate = dhakaDateISO(now, env.NEXT_PUBLIC_APP_TIMEZONE);
  const dayName = dhakaDayName(now, env.NEXT_PUBLIC_APP_TIMEZONE);
  const jobKey = `scheduled:${slot}:${trackingDate}`;

  if (!(await createJobRun("scheduled_send", jobKey, { slot, trackingDate, dayName }))) {
    return { skipped: true, reason: "duplicate_job" as const };
  }

  try {
    if (!isWorkingDay(now)) {
      await completeJobRun(jobKey, "success", "Skipped non-working day");
      return { skipped: true, reason: "non_working_day" as const };
    }

    const trackedEmployees = await getTrackedEmployees();
    const employees = filterAllowedEmployees(trackedEmployees);
    const previous = previousSlot(slot);
    const previousDate = previous.dateOffsetDays === 0
      ? trackingDate
      : dhakaDateISO(subDays(now, 1), env.NEXT_PUBLIC_APP_TIMEZONE);

    await markMissingForSlot({
      trackingDate: previousDate,
      slotKey: previous.slot,
      employeeIds: employees.map((employee) => employee.id),
    });

    const template = await getTemplateBySlot(slot);
    if (!template) {
      throw new Error(`No active template configured for slot ${slot}`);
    }

    let sent = 0;
    let failed = 0;

    for (const employee of employees) {
      try {
        const response = await sendDynamicTemplateMessage({
          toE164: employee.whatsapp_e164,
          templateName: template.template_name,
          languageCode: template.language_code,
          bodyParameters: scheduledBodyParameters(
            slot,
            employee.full_name,
            env.WHATSAPP_MORNING_TEMPLATE_BODY,
          ),
        });

        await insertMessageEvent({
          employeeId: employee.id,
          direction: "outbound",
          category: "scheduled_prompt",
          slotKey: slot,
          trackingDate,
          whatsappMessageId: response.id ?? null,
          payload: {
            template: template.template_name,
            language: template.language_code,
            slot,
          },
          messageText: `[template] ${template.template_name}`,
        });

        sent += 1;
      } catch (error) {
        failed += 1;
        logError("Scheduled send failed for employee", {
          employeeId: employee.id,
          slot,
          trackingDate,
          error: (error as Error).message,
        });
      }
    }

    const testNote = isWhatsAppTestAllowlistEnabled() ? `,test_allowlist=${employees.length}` : "";
    await completeJobRun(jobKey, "success", `sent=${sent},failed=${failed}${testNote}`);
    return { skipped: false, sent, failed };
  } catch (error) {
    await completeJobRun(jobKey, "failed", (error as Error).message);
    throw error;
  }
}

export async function processInboundWebhookPayload(payload: Record<string, unknown>) {
  const messages = extractMessages(payload);

  let processed = 0;
  let ignored = 0;

  for (const message of messages) {
    if (!message.from || !message.timestamp) {
      ignored += 1;
      continue;
    }

    const incomingDate = new Date(Number(message.timestamp) * 1000);
    const trackingDate = dhakaDateISO(incomingDate, env.NEXT_PUBLIC_APP_TIMEZONE);
    const slotKey = slotForTimestamp(incomingDate, env.NEXT_PUBLIC_APP_TIMEZONE);

    const employee = await findEmployeeByWhatsAppFrom(message.from);
    const fragment = formatInboundFragment(message);

    await insertMessageEvent({
      employeeId: employee?.id ?? null,
      direction: "inbound",
      category: employee ? "employee_reply" : "unknown_sender",
      slotKey,
      trackingDate,
      whatsappMessageId: message.id,
      payload,
      messageText: fragment,
      locationLat: message.location?.latitude ?? null,
      locationLng: message.location?.longitude ?? null,
      receivedAt: incomingDate.toISOString(),
    });

    if (!employee || !employee.tracking_enabled || !employee.is_active) {
      ignored += 1;
      continue;
    }

    await mergeSlotResponse({
      employeeId: employee.id,
      trackingDate,
      slotKey,
      replyAt: incomingDate.toISOString(),
      mergedFragment: fragment,
    });

    processed += 1;
  }

  logInfo("Inbound webhook processed", { processed, ignored, total: messages.length });
  return { processed, ignored, total: messages.length };
}
