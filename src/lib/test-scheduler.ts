import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/config";
import { supabaseAdmin } from "@/lib/db";
import { logError, logInfo } from "@/lib/logger";
import {
  getTemplateBySlot,
  insertMessageEvent,
  listEmployees,
} from "@/lib/repository";
import { scheduledBodyParameters } from "@/lib/scheduled-template";
import { dhakaDateISO } from "@/lib/time";
import type { SlotKey } from "@/lib/types";
import { sendDynamicTemplateMessage } from "@/lib/whatsapp";
import { filterAllowedEmployees } from "@/lib/whatsapp-test-allowlist";

const TEST_SCHEDULE_JOB_TYPE = "test_scheduled_send";
const templateKeySchema = z.enum(["morning", "noon", "afternoon", "evening", "ceo_broadcast_test"]);

const schedulePayloadSchema = z.object({
  templateKey: templateKeySchema,
  scheduledAtIso: z.string().datetime(),
  recipientEmployeeIds: z.array(z.string().uuid()).min(1).max(200),
  morningBodyText: z.string().max(1500).optional().default(""),
  createdAtIso: z.string().datetime(),
});

const scheduleCreateInputSchema = z.object({
  templateKey: templateKeySchema,
  scheduledAtIso: z.string().datetime(),
  recipientEmployeeIds: z.array(z.string().uuid()).min(1).max(200),
  morningBodyText: z.string().max(1500).optional().default(""),
});

type TemplateKey = z.infer<typeof templateKeySchema>;
type SchedulePayload = z.infer<typeof schedulePayloadSchema>;
type ScheduleCreateInput = z.infer<typeof scheduleCreateInputSchema>;

type JobRunRow = {
  id: string;
  job_key: string;
  status: "running" | "success" | "failed";
  note: string | null;
  payload: unknown;
  created_at: string;
  finished_at: string | null;
};

type EmployeeLite = {
  id: string;
  full_name: string;
  whatsapp_e164: string;
};

export type TestScheduleItem = {
  id: string;
  jobKey: string;
  status: "running" | "success" | "failed";
  note: string | null;
  templateKey: TemplateKey | null;
  scheduledAtIso: string | null;
  createdAt: string;
  finishedAt: string | null;
  recipientCount: number;
  recipients: EmployeeLite[];
};

export type DispatchSummary = {
  due: number;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
};

function ensureNoError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function parsePayload(raw: unknown): SchedulePayload | null {
  const parsed = schedulePayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function buildEmployeesMap(rows: Array<{ id: string; full_name: string; whatsapp_e164: string }>) {
  return new Map(rows.map((item) => [item.id, item]));
}

function scheduleToItem(row: JobRunRow, employeesById: Map<string, EmployeeLite>): TestScheduleItem {
  const payload = parsePayload(row.payload);
  const recipientIds = payload ? payload.recipientEmployeeIds : [];
  const recipients = recipientIds
    .map((id) => employeesById.get(id))
    .filter(Boolean) as EmployeeLite[];

  return {
    id: row.id,
    jobKey: row.job_key,
    status: row.status,
    note: row.note,
    templateKey: payload?.templateKey ?? null,
    scheduledAtIso: payload?.scheduledAtIso ?? null,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    recipientCount: recipientIds.length,
    recipients,
  };
}

async function updateJobRunCompletion(input: {
  id: string;
  status: "success" | "failed";
  note: string;
}) {
  const result = await supabaseAdmin
    .from("job_runs")
    .update({
      status: input.status,
      note: input.note,
      finished_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  ensureNoError(result.error, "Failed to update test schedule job");
}

function isDue(payload: SchedulePayload, now: Date): boolean {
  const scheduledMs = Date.parse(payload.scheduledAtIso);
  if (!Number.isFinite(scheduledMs)) return false;
  return scheduledMs <= now.getTime();
}

export async function createTestSchedule(input: ScheduleCreateInput) {
  const parsed = scheduleCreateInputSchema.safeParse({
    ...input,
    recipientEmployeeIds: dedupeIds(input.recipientEmployeeIds),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || "Invalid test schedule payload");
  }

  const scheduledAtMs = Date.parse(parsed.data.scheduledAtIso);
  if (!Number.isFinite(scheduledAtMs)) {
    throw new Error("Invalid scheduled time");
  }
  if (scheduledAtMs < Date.now() - 30_000) {
    throw new Error("Scheduled time must be current or future");
  }

  const allEmployees = await listEmployees();
  const allIds = new Set(allEmployees.map((row) => row.id));
  const validIds = parsed.data.recipientEmployeeIds.filter((id) => allIds.has(id));

  if (validIds.length === 0) {
    throw new Error("None of the selected recipients are valid");
  }

  const payload: SchedulePayload = {
    templateKey: parsed.data.templateKey,
    scheduledAtIso: new Date(scheduledAtMs).toISOString(),
    recipientEmployeeIds: validIds,
    morningBodyText: parsed.data.morningBodyText ?? "",
    createdAtIso: new Date().toISOString(),
  };

  const insert = await supabaseAdmin
    .from("job_runs")
    .insert({
      job_type: TEST_SCHEDULE_JOB_TYPE,
      job_key: `test_schedule:${randomUUID()}`,
      payload,
    })
    .select("id,job_key")
    .single();

  ensureNoError(insert.error, "Failed to create test schedule");
  if (!insert.data?.id || !insert.data?.job_key) {
    throw new Error("Failed to return inserted test schedule");
  }

  return {
    id: insert.data.id,
    jobKey: insert.data.job_key,
    payload,
  };
}

export async function listTestSchedules(limit = 60): Promise<TestScheduleItem[]> {
  const schedulesRes = await supabaseAdmin
    .from("job_runs")
    .select("id,job_key,status,note,payload,created_at,finished_at")
    .eq("job_type", TEST_SCHEDULE_JOB_TYPE)
    .order("created_at", { ascending: false })
    .limit(limit);

  ensureNoError(schedulesRes.error, "Failed to load test schedules");

  const employees = await listEmployees();
  const employeesById = buildEmployeesMap(
    employees.map((employee) => ({
      id: employee.id,
      full_name: employee.full_name,
      whatsapp_e164: employee.whatsapp_e164,
    })),
  );

  return ((schedulesRes.data ?? []) as JobRunRow[]).map((row) => scheduleToItem(row, employeesById));
}

export async function cancelTestSchedule(id: string): Promise<boolean> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    throw new Error("Invalid test schedule id");
  }

  const update = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "failed",
      note: "cancelled_by_admin",
      finished_at: new Date().toISOString(),
    })
    .eq("id", parsed.data)
    .eq("job_type", TEST_SCHEDULE_JOB_TYPE)
    .eq("status", "running")
    .select("id");

  ensureNoError(update.error, "Failed to cancel test schedule");
  return Boolean(update.data?.length);
}

async function executeDueSchedule(
  row: JobRunRow,
  payload: SchedulePayload,
  employeesById: Map<string, EmployeeLite>,
  now: Date,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const resolved = payload.recipientEmployeeIds
    .map((id) => employeesById.get(id))
    .filter(Boolean) as EmployeeLite[];
  const recipients = filterAllowedEmployees(resolved);

  if (recipients.length === 0) {
    await updateJobRunCompletion({
      id: row.id,
      status: "failed",
      note: "No valid recipients after allowlist filter",
    });
    return { sent: 0, failed: 0, skipped: 1 };
  }

  let sent = 0;
  let failed = 0;
  const trackingDate = dhakaDateISO(now, env.NEXT_PUBLIC_APP_TIMEZONE);
  const isCeoBroadcastTest = payload.templateKey === "ceo_broadcast_test";

  const template = isCeoBroadcastTest
    ? {
        template_name: env.WHATSAPP_BROADCAST_TEMPLATE_NAME,
        language_code: "en",
      }
    : await getTemplateBySlot(payload.templateKey as SlotKey);

  if (!template) {
    await updateJobRunCompletion({
      id: row.id,
      status: "failed",
      note: `No active template configured for key ${payload.templateKey}`,
    });
    return { sent: 0, failed: recipients.length, skipped: 0 };
  }

  for (const employee of recipients) {
    try {
      const bodyParameters = isCeoBroadcastTest
        ? [
            {
              type: "text" as const,
              parameterName: "body",
              text: payload.morningBodyText || env.WHATSAPP_MORNING_TEMPLATE_BODY,
            },
          ]
        : scheduledBodyParameters(
            payload.templateKey as SlotKey,
            employee.full_name,
            payload.morningBodyText || env.WHATSAPP_MORNING_TEMPLATE_BODY,
          );

      const response = await sendDynamicTemplateMessage({
        toE164: employee.whatsapp_e164,
        templateName: template.template_name,
        languageCode: template.language_code,
        bodyParameters,
      });

      await insertMessageEvent({
        employeeId: employee.id,
        direction: "outbound",
        category: isCeoBroadcastTest ? "scheduled_test_ceo_broadcast" : "scheduled_test_prompt",
        slotKey: isCeoBroadcastTest ? null : (payload.templateKey as SlotKey),
        trackingDate,
        whatsappMessageId: response.id ?? null,
        payload: {
          scheduleJobId: row.id,
          scheduleJobKey: row.job_key,
          scheduledAt: payload.scheduledAtIso,
          template: template.template_name,
          language: template.language_code,
          templateKey: payload.templateKey,
          mode: "test_scheduler_frontend",
        },
        messageText: isCeoBroadcastTest
          ? payload.morningBodyText || env.WHATSAPP_MORNING_TEMPLATE_BODY
          : `[template] ${template.template_name}`,
      });

      sent += 1;
    } catch (error) {
      failed += 1;
      logError("Test schedule send failed", {
        scheduleId: row.id,
        employeeId: employee.id,
        templateKey: payload.templateKey,
        error: (error as Error).message,
      });
    }
  }

  const status: "success" | "failed" = failed > 0 ? "failed" : "success";
  await updateJobRunCompletion({
    id: row.id,
    status,
    note: `template=${payload.templateKey};scheduled=${payload.scheduledAtIso};recipients=${recipients.length};sent=${sent};failed=${failed}`,
  });

  return { sent, failed, skipped: 0 };
}

export async function dispatchDueTestSchedules(now = new Date()): Promise<DispatchSummary> {
  const pendingRes = await supabaseAdmin
    .from("job_runs")
    .select("id,job_key,status,note,payload,created_at,finished_at")
    .eq("job_type", TEST_SCHEDULE_JOB_TYPE)
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(200);

  ensureNoError(pendingRes.error, "Failed to load pending test schedules");

  const rows = (pendingRes.data ?? []) as JobRunRow[];
  const parsedRows = rows.map((row) => ({ row, payload: parsePayload(row.payload) }));
  const invalidRows = parsedRows.filter((item) => !item.payload).map((item) => item.row);

  for (const row of invalidRows) {
    await updateJobRunCompletion({
      id: row.id,
      status: "failed",
      note: "Invalid schedule payload",
    });
  }

  const dueRows = parsedRows
    .filter((item) => item.payload && isDue(item.payload, now)) as Array<{ row: JobRunRow; payload: SchedulePayload }>;

  if (dueRows.length === 0) {
    return { due: 0, processed: invalidRows.length, sent: 0, failed: invalidRows.length, skipped: 0 };
  }

  const employees = await listEmployees();
  const employeesById = buildEmployeesMap(
    employees.map((employee) => ({
      id: employee.id,
      full_name: employee.full_name,
      whatsapp_e164: employee.whatsapp_e164,
    })),
  );

  let processed = invalidRows.length;
  let sent = 0;
  let failed = invalidRows.length;
  let skipped = 0;

  for (const item of dueRows) {
    try {
      const result = await executeDueSchedule(item.row, item.payload, employeesById, now);
      processed += 1;
      sent += result.sent;
      failed += result.failed;
      skipped += result.skipped;
    } catch (error) {
      failed += 1;
      processed += 1;
      await updateJobRunCompletion({
        id: item.row.id,
        status: "failed",
        note: (error as Error).message || "Unhandled dispatch error",
      });
    }
  }

  logInfo("Test schedule dispatch completed", { due: dueRows.length, processed, sent, failed, skipped });
  return { due: dueRows.length, processed, sent, failed, skipped };
}
