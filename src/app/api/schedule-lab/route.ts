import { z } from "zod";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
import { fail, ok } from "@/lib/http";
import { createScheduleLabEntry, listScheduleLabEntries } from "@/lib/repository";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);
const slotSchema = z.enum(["morning", "noon", "afternoon", "evening"]);
const reportSlotSchema = z.string().trim().min(2).max(40).regex(/^[a-z][a-z0-9_-]*$/);

const createSchema = z.object({
  label: z.string().min(2).max(80),
  timeHHmm: timeSchema,
  bodyText: z.string().min(1).max(1500),
  templateName: z.string().min(1).max(120).default(env.WHATSAPP_SCHEDULED_TEMPLATE_NAME),
  languageCode: z.string().min(2).max(30).default(env.WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE),
  isActive: z.boolean().default(true),
  legacySlotKey: slotSchema.nullable().optional().default(null),
  reportSlotKey: reportSlotSchema.nullable().optional().default(null),
  reportMandatory: z.boolean().default(true),
  reportCritical: z.boolean().default(false),
  reportWeight: z.coerce.number().min(0).max(100).default(1),
});

function parseMinuteOfDay(timeHHmm: string): number {
  const [hour, minute] = timeHHmm.split(":").map((item) => Number(item));
  return hour * 60 + minute;
}

function normalizeScheduleError(error: unknown): string {
  const message = (error as Error).message || "Schedule lab request failed";
  const lower = message.toLowerCase();

  if (lower.includes("idx_schedule_lab_entries_active_minute_unique")) {
    return "Another active schedule already exists at this time. Use a different time or deactivate one first.";
  }

  if (lower.includes("idx_schedule_lab_entries_active_report_slot_unique")) {
    return "Another active schedule is already mapped to that report slot.";
  }

  if (lower.includes("schedule_lab_entries_legacy_slot_key_key")) {
    return "This legacy slot key is already assigned to another schedule.";
  }

  if (lower.includes("schedule_lab_entries_report_slot_key_format_check")) {
    return "Report slot key must be lowercase and can include letters, numbers, underscore, or hyphen.";
  }

  return message;
}

export async function GET(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  try {
    const schedules = await listScheduleLabEntries();
    return ok({ schedules });
  } catch (error) {
    return fail(normalizeScheduleError(error), 500);
  }
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  if (parsed.data.reportCritical && !parsed.data.reportMandatory) {
    return fail("Critical schedule must also be marked mandatory.", 400);
  }

  try {
    const created = await createScheduleLabEntry({
      label: parsed.data.label,
      minuteOfDay: parseMinuteOfDay(parsed.data.timeHHmm),
      bodyText: parsed.data.bodyText,
      templateName: parsed.data.templateName,
      languageCode: parsed.data.languageCode,
      isActive: parsed.data.isActive,
      legacySlotKey: parsed.data.legacySlotKey,
      reportSlotKey: parsed.data.reportSlotKey,
      reportMandatory: parsed.data.reportMandatory,
      reportCritical: parsed.data.reportCritical,
      reportWeight: parsed.data.reportWeight,
    });
    return ok({ schedule: created });
  } catch (error) {
    return fail(normalizeScheduleError(error), 500);
  }
}
