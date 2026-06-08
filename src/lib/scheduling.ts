import { subDays } from "date-fns";
import { env } from "@/lib/config";
import { mapWithConcurrency } from "@/lib/concurrency";
import { WORKING_DAYS } from "@/lib/constants";
import { logError, logInfo } from "@/lib/logger";
import { dhakaDateISO, dhakaDayName, minuteOfDayForTimezone } from "@/lib/time";
import type { LegacySlotKey, ReportSlotKey, WhatsAppInboundMessage } from "@/lib/types";
import {
  completeJobRun,
  createJobRun,
  findEmployeeByWhatsAppFrom,
  findMessageEventByWhatsAppMessageId,
  getScheduleLabEntryByLegacySlot,
  getTemplateBySlot,
  getTrackedEmployees,
  insertMessageEvent,
  listDueActiveScheduleLabEntries,
  type ScheduleLabEntry,
  listRecentInboundClassifiedRepliesForEmployee,
  listRecentOutboundPromptEventsForEmployee,
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

function previousSlot(slot: LegacySlotKey): { slot: LegacySlotKey; dateOffsetDays: number } {
  if (slot === "morning") return { slot: "evening", dateOffsetDays: -1 };
  if (slot === "noon") return { slot: "morning", dateOffsetDays: 0 };
  if (slot === "afternoon") return { slot: "noon", dateOffsetDays: 0 };
  return { slot: "afternoon", dateOffsetDays: 0 };
}

function scheduleBodyParameters(employeeName: string, bodyText: string): Array<{
  type: "text";
  text: string;
  parameterName: string;
}> {
  return [
    {
      type: "text",
      parameterName: "employee_name",
      text: employeeName,
    },
    {
      type: "text",
      parameterName: "body",
      text: bodyText.trim(),
    },
  ];
}

// Compact, human-readable summary of why sends failed, stored on the job_run note
// so failures are diagnosable without digging through serverless logs.
function summarizeFailureReasons(reasons: Map<string, number>): string {
  if (reasons.size === 0) return "";
  const parts = Array.from(reasons.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${count}x ${reason.slice(0, 80)}`);
  return ` | ${parts.join("; ")}`;
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

type InboundReplyCategory =
  | "scheduled_reply"
  | "broadcast_reply"
  | "general_reply"
  | "unknown_sender";

type InboundReplyClassification = {
  category: InboundReplyCategory;
  linkedOutboundMessageId: string | null;
  linkedOutboundCategory: string | null;
  slotKey: ReportSlotKey | null;
  trackingDate: string | null;
  reason: string;
};

const SCHEDULED_OUTBOUND_CATEGORY = "scheduled_prompt";
const SCHEDULED_GENERAL_OUTBOUND_CATEGORY = "scheduled_general_prompt";
const BROADCAST_OUTBOUND_CATEGORY = "ceo_broadcast_template";
// Recipients per slot are sent in parallel so a full roster finishes well within
// the serverless function timeout instead of one-by-one.
const SCHEDULED_SEND_CONCURRENCY = 8;
const REPLY_LOOKBACK_HOURS = 18;
const CONTINUATION_LOOKBACK_MINUTES = 45;
const OUTBOUND_AMBIGUITY_GAP_MINUTES = 20;

function inboundReplyContextId(message: WhatsAppInboundMessage): string | null {
  const value = message.context?.id;
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function replyCategoryFromOutboundCategory(category: string): InboundReplyCategory | null {
  if (category === SCHEDULED_OUTBOUND_CATEGORY) return "scheduled_reply";
  if (category === BROADCAST_OUTBOUND_CATEGORY) return "broadcast_reply";
  return null;
}

function minutesBetween(olderIso: string, newerIso: string): number | null {
  const older = new Date(olderIso).getTime();
  const newer = new Date(newerIso).getTime();
  if (Number.isNaN(older) || Number.isNaN(newer)) return null;
  return Math.max(0, Math.floor((newer - older) / 60000));
}

async function classifyInboundReply(input: {
  employee: { id: string } | null;
  message: WhatsAppInboundMessage;
  receivedAtIso: string;
}): Promise<InboundReplyClassification> {
  if (!input.employee) {
    return {
      category: "unknown_sender",
      linkedOutboundMessageId: null,
      linkedOutboundCategory: null,
      slotKey: null,
      trackingDate: null,
      reason: "employee_not_found",
    };
  }

  const replyContextId = inboundReplyContextId(input.message);
  if (replyContextId) {
    const linked = await findMessageEventByWhatsAppMessageId(replyContextId);
    if (linked && linked.direction === "outbound" && linked.employeeId === input.employee.id) {
      const mappedCategory = replyCategoryFromOutboundCategory(linked.category);
      if (mappedCategory) {
        return {
          category: mappedCategory,
          linkedOutboundMessageId: linked.whatsappMessageId ?? replyContextId,
          linkedOutboundCategory: linked.category,
          slotKey: mappedCategory === "scheduled_reply" ? linked.slotKey : null,
          trackingDate: mappedCategory === "scheduled_reply" ? linked.trackingDate : null,
          reason: "context_linked_outbound",
        };
      }
    }
  }

  const continuationCandidates = await listRecentInboundClassifiedRepliesForEmployee({
    employeeId: input.employee.id,
    occurredBefore: input.receivedAtIso,
    lookbackMinutes: CONTINUATION_LOOKBACK_MINUTES,
  });
  const continuation = continuationCandidates[0];
  if (continuation && (continuation.category === "scheduled_reply" || continuation.category === "broadcast_reply")) {
    return {
      category: continuation.category as InboundReplyCategory,
      linkedOutboundMessageId: null,
      linkedOutboundCategory: continuation.category === "scheduled_reply"
        ? SCHEDULED_OUTBOUND_CATEGORY
        : BROADCAST_OUTBOUND_CATEGORY,
      slotKey: continuation.category === "scheduled_reply" ? continuation.slotKey : null,
      trackingDate: continuation.category === "scheduled_reply" ? continuation.trackingDate : null,
      reason: "chunk_continuation",
    };
  }

  const recentOutbound = await listRecentOutboundPromptEventsForEmployee({
    employeeId: input.employee.id,
    occurredBefore: input.receivedAtIso,
    lookbackHours: REPLY_LOOKBACK_HOURS,
  });
  const nearest = recentOutbound[0];
  const secondNearest = recentOutbound[1];

  if (nearest && secondNearest && nearest.category !== secondNearest.category) {
    const gap = minutesBetween(secondNearest.occurredAt, nearest.occurredAt);
    if (gap !== null && gap <= OUTBOUND_AMBIGUITY_GAP_MINUTES) {
      return {
        category: "general_reply",
        linkedOutboundMessageId: null,
        linkedOutboundCategory: null,
        slotKey: null,
        trackingDate: null,
        reason: "ambiguous_recent_outbounds",
      };
    }
  }

  if (nearest) {
    const mappedCategory = replyCategoryFromOutboundCategory(nearest.category);
    if (mappedCategory) {
      const ageMinutes = minutesBetween(nearest.occurredAt, input.receivedAtIso);
      const limitMinutes = mappedCategory === "scheduled_reply" ? 16 * 60 : 6 * 60;

      if (ageMinutes === null || ageMinutes <= limitMinutes) {
        return {
          category: mappedCategory,
          linkedOutboundMessageId: nearest.whatsappMessageId,
          linkedOutboundCategory: nearest.category,
          slotKey: mappedCategory === "scheduled_reply" ? nearest.slotKey : null,
          trackingDate: mappedCategory === "scheduled_reply" ? nearest.trackingDate : null,
          reason: "recent_outbound_fallback",
        };
      }
    }
  }

  return {
    category: "general_reply",
    linkedOutboundMessageId: null,
    linkedOutboundCategory: null,
    slotKey: null,
    trackingDate: null,
    reason: replyContextId ? "context_unmatched" : "no_context",
  };
}

async function runLegacyScheduledSlot(slot: LegacySlotKey, now = new Date()) {
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
    const failureReasons = new Map<string, number>();

    await mapWithConcurrency(employees, SCHEDULED_SEND_CONCURRENCY, async (employee) => {
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
        const reason = (error as Error).message || "unknown error";
        failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        logError("Scheduled send failed for employee", {
          employeeId: employee.id,
          slot,
          trackingDate,
          error: reason,
        });
      }
    });

    const testNote = isWhatsAppTestAllowlistEnabled() ? `,test_allowlist=${employees.length}` : "";
    await completeJobRun(
      jobKey,
      "success",
      `sent=${sent},failed=${failed}${testNote}${summarizeFailureReasons(failureReasons)}`,
    );
    return { skipped: false, sent, failed };
  } catch (error) {
    await completeJobRun(jobKey, "failed", (error as Error).message);
    throw error;
  }
}

async function runScheduleLabEntry(entry: ScheduleLabEntry, now = new Date()) {
  const trackingDate = dhakaDateISO(now, env.NEXT_PUBLIC_APP_TIMEZONE);
  const dayName = dhakaDayName(now, env.NEXT_PUBLIC_APP_TIMEZONE);
  const jobKey = `scheduled_lab:${entry.id}:${trackingDate}`;

  if (!(await createJobRun("scheduled_send", jobKey, {
    scheduleId: entry.id,
    label: entry.label,
    minuteOfDay: entry.minuteOfDay,
    trackingDate,
    dayName,
  }))) {
    return { skipped: true, reason: "duplicate_job" as const, scheduleId: entry.id };
  }

  try {
    if (!isWorkingDay(now)) {
      await completeJobRun(jobKey, "success", "Skipped non-working day");
      return { skipped: true, reason: "non_working_day" as const, scheduleId: entry.id };
    }

    const trackedEmployees = await getTrackedEmployees();
    const employees = filterAllowedEmployees(trackedEmployees);

    if (entry.reportSlotKey) {
      await markMissingForSlot({
        trackingDate,
        slotKey: entry.reportSlotKey,
        employeeIds: employees.map((employee) => employee.id),
      });
    }

    const category = entry.reportSlotKey ? SCHEDULED_OUTBOUND_CATEGORY : SCHEDULED_GENERAL_OUTBOUND_CATEGORY;

    let sent = 0;
    let failed = 0;
    const failureReasons = new Map<string, number>();

    await mapWithConcurrency(employees, SCHEDULED_SEND_CONCURRENCY, async (employee) => {
      try {
        const response = await sendDynamicTemplateMessage({
          toE164: employee.whatsapp_e164,
          templateName: entry.templateName,
          languageCode: entry.languageCode,
          bodyParameters: scheduleBodyParameters(employee.full_name, entry.bodyText),
        });

        await insertMessageEvent({
          employeeId: employee.id,
          direction: "outbound",
          category,
          slotKey: entry.reportSlotKey,
          trackingDate: entry.reportSlotKey ? trackingDate : null,
          whatsappMessageId: response.id ?? null,
          payload: {
            scheduleId: entry.id,
            scheduleLabel: entry.label,
            minuteOfDay: entry.minuteOfDay,
            template: entry.templateName,
            language: entry.languageCode,
            reportSlotKey: entry.reportSlotKey,
            reportMandatory: entry.reportMandatory,
            reportCritical: entry.reportCritical,
            reportWeight: entry.reportWeight,
          },
          messageText: `[schedule] ${entry.label}`,
        });

        sent += 1;
      } catch (error) {
        failed += 1;
        const reason = (error as Error).message || "unknown error";
        failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        logError("Schedule lab send failed for employee", {
          employeeId: employee.id,
          scheduleId: entry.id,
          scheduleLabel: entry.label,
          trackingDate,
          error: reason,
        });
      }
    });

    const testNote = isWhatsAppTestAllowlistEnabled() ? `,test_allowlist=${employees.length}` : "";
    await completeJobRun(
      jobKey,
      "success",
      `sent=${sent},failed=${failed}${testNote}${summarizeFailureReasons(failureReasons)}`,
    );
    return { skipped: false, sent, failed, scheduleId: entry.id };
  } catch (error) {
    await completeJobRun(jobKey, "failed", (error as Error).message);
    throw error;
  }
}

// Catch-up window so a schedule still fires if the dispatch cron drifts or runs
// every few minutes rather than exactly on the minute. Per-day job_key dedup
// (createJobRun) guarantees each schedule still sends at most once.
const DISPATCH_CATCHUP_MINUTES = 15;

export async function runDueScheduleLabDispatch(now = new Date()) {
  const minuteOfDay = minuteOfDayForTimezone(now, env.NEXT_PUBLIC_APP_TIMEZONE);
  const dueSchedules = await listDueActiveScheduleLabEntries(minuteOfDay, DISPATCH_CATCHUP_MINUTES);

  if (dueSchedules.length === 0) {
    return {
      ok: true,
      minuteOfDay,
      due: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      schedules: [] as Array<{ scheduleId: string; label: string }>,
    };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const schedules: Array<{ scheduleId: string; label: string }> = [];

  for (const schedule of dueSchedules) {
    schedules.push({ scheduleId: schedule.id, label: schedule.label });
    const result = await runScheduleLabEntry(schedule, now);
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    sent += Number(result.sent ?? 0);
    failed += Number(result.failed ?? 0);
  }

  return {
    ok: true,
    minuteOfDay,
    due: dueSchedules.length,
    sent,
    failed,
    skipped,
    schedules,
  };
}

export async function runScheduledSlot(slot: LegacySlotKey, now = new Date()) {
  const mapped = await getScheduleLabEntryByLegacySlot(slot, { includeInactive: true });
  if (!mapped) {
    return runLegacyScheduledSlot(slot, now);
  }

  if (!mapped.isActive) {
    return {
      skipped: true as const,
      reason: "schedule_lab_legacy_slot_inactive" as const,
      scheduleId: mapped.id,
    };
  }

  const currentMinute = minuteOfDayForTimezone(now, env.NEXT_PUBLIC_APP_TIMEZONE);
  if (currentMinute !== mapped.minuteOfDay) {
    return {
      skipped: true as const,
      reason: "schedule_lab_time_mismatch" as const,
      scheduleId: mapped.id,
      expectedMinute: mapped.minuteOfDay,
      currentMinute,
    };
  }

  return runScheduleLabEntry(mapped, now);
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
    const receivedAtIso = incomingDate.toISOString();

    const employee = await findEmployeeByWhatsAppFrom(message.from);
    const fragment = formatInboundFragment(message);
    const replyContextId = inboundReplyContextId(message);
    const classification = await classifyInboundReply({
      employee,
      message,
      receivedAtIso,
    });

    const scheduledTrackingDate = classification.trackingDate;
    const scheduledSlotKey = classification.slotKey;
    const shouldMergeIntoSlot =
      classification.category === "scheduled_reply" &&
      Boolean(scheduledTrackingDate && scheduledSlotKey);

    await insertMessageEvent({
      employeeId: employee?.id ?? null,
      direction: "inbound",
      category: classification.category,
      slotKey: shouldMergeIntoSlot ? scheduledSlotKey : null,
      trackingDate: shouldMergeIntoSlot ? scheduledTrackingDate : null,
      whatsappMessageId: message.id,
      // Store only what the conversations view needs, not the full webhook
      // envelope, to keep message_events small (free-tier storage).
      payload: {
        from: message.from,
        message_id: message.id ?? null,
        type: message.type ?? null,
        _reply_context_message_id: replyContextId,
        _reply_classification: classification.category,
        _reply_linked_outbound_message_id: classification.linkedOutboundMessageId,
        _reply_linked_outbound_category: classification.linkedOutboundCategory,
        _reply_classification_reason: classification.reason,
      },
      messageText: fragment,
      locationLat: message.location?.latitude ?? null,
      locationLng: message.location?.longitude ?? null,
      receivedAt: receivedAtIso,
    });

    if (!employee || !employee.tracking_enabled || !employee.is_active) {
      ignored += 1;
      continue;
    }

    if (!shouldMergeIntoSlot) {
      ignored += 1;
      continue;
    }

    if (!scheduledTrackingDate || !scheduledSlotKey) {
      ignored += 1;
      continue;
    }

    await mergeSlotResponse({
      employeeId: employee.id,
      trackingDate: scheduledTrackingDate,
      slotKey: scheduledSlotKey,
      replyAt: receivedAtIso,
      mergedFragment: fragment,
    });

    processed += 1;
  }

  logInfo("Inbound webhook processed", { processed, ignored, total: messages.length });
  return { processed, ignored, total: messages.length };
}
