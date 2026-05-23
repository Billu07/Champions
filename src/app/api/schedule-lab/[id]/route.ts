import { z } from "zod";
import { requestHasAdminSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { deleteScheduleLabEntry, updateScheduleLabEntry } from "@/lib/repository";

const idSchema = z.string().uuid();
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);
const slotSchema = z.enum(["morning", "noon", "afternoon", "evening"]);
const reportSlotSchema = z.string().trim().min(2).max(40).regex(/^[a-z][a-z0-9_-]*$/);

const patchSchema = z.object({
  label: z.string().min(2).max(80).optional(),
  timeHHmm: timeSchema.optional(),
  bodyText: z.string().min(1).max(1500).optional(),
  templateName: z.string().min(1).max(120).optional(),
  languageCode: z.string().min(2).max(30).optional(),
  isActive: z.boolean().optional(),
  legacySlotKey: slotSchema.nullable().optional(),
  reportSlotKey: reportSlotSchema.nullable().optional(),
  reportMandatory: z.boolean().optional(),
  reportCritical: z.boolean().optional(),
  reportWeight: z.coerce.number().min(0).max(100).optional(),
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return fail("Invalid schedule id", 400);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  if (Object.keys(parsed.data).length === 0) {
    return fail("No fields to update", 400);
  }

  const reportMandatory = parsed.data.reportMandatory;
  const reportCritical = parsed.data.reportCritical;
  if (reportCritical === true && reportMandatory === false) {
    return fail("Critical schedule must also be marked mandatory.", 400);
  }

  try {
    const updated = await updateScheduleLabEntry(parsedId.data, {
      label: parsed.data.label,
      minuteOfDay: parsed.data.timeHHmm ? parseMinuteOfDay(parsed.data.timeHHmm) : undefined,
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
    return ok({ schedule: updated });
  } catch (error) {
    return fail(normalizeScheduleError(error), 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return fail("Invalid schedule id", 400);
  }

  try {
    await deleteScheduleLabEntry(parsedId.data);
    return ok({ deleted: true });
  } catch (error) {
    return fail(normalizeScheduleError(error), 500);
  }
}
