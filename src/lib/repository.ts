import { normalizeBangladeshPhone } from "@/lib/phone";
import { supabaseAdmin } from "@/lib/db";
import { env } from "@/lib/config";
import { TRACKING_TAG_KEY } from "@/lib/constants";
import type {
  BroadcastDeliveryLifecycleStatus,
  LegacySlotKey,
  ReportKind,
  ReportSlotKey,
  SlotKey,
} from "@/lib/types";

export type EmployeeRow = {
  id: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  branch: string | null;
  whatsapp_number_raw: string;
  whatsapp_e164: string;
  tracking_enabled: boolean;
  is_active: boolean;
  status: string;
  aliases: string[];
  notes: string | null;
};

export type EmployeeTagRow = {
  employee_id: string;
  tags:
    | {
        key: string;
        label: string;
      }
    | Array<{
        key: string;
        label: string;
      }>
    | null;
};

type UpsertEmployeeInput = {
  id?: string;
  fullName: string;
  designation?: string;
  department?: string;
  branch?: string;
  whatsappNumber: string;
  trackingEnabled: boolean;
  isActive: boolean;
  status?: string;
  aliases?: string[];
  notes?: string;
  tagKeys?: string[];
};

function must<T>(value: T | null, message: string): T {
  if (!value) throw new Error(message);
  return value;
}

function ensureNoError(error: { message: string } | null, fallback: string): void {
  if (error) {
    throw new Error(error.message || fallback);
  }
}

type EmployeesSchemaMode = "modern" | "legacy";
type BroadcastDeliverySchemaMode = "modern" | "legacy";
type ScheduleLabSchemaMode = "available" | "missing";

const MODERN_EMPLOYEE_SELECT =
  "id,full_name,designation,department,branch,whatsapp_number_raw,whatsapp_e164,tracking_enabled,is_active,status,aliases,notes";
const LEGACY_EMPLOYEE_SELECT =
  "id,full_name,designation,department,branch,whatsapp_number,is_active_for_tracking,status,created_at,updated_at";

let cachedEmployeeSchema: EmployeesSchemaMode | null = null;
let cachedTagSupport: boolean | null = null;
let cachedBroadcastDeliverySchema: BroadcastDeliverySchemaMode | null = null;
let cachedScheduleLabSchema: ScheduleLabSchemaMode | null = null;

function isMissingColumnOrTableError(error: { message?: string } | null | undefined): boolean {
  if (!error?.message) return false;
  const text = error.message.toLowerCase();
  return (
    text.includes("could not find") ||
    text.includes("schema cache") ||
    text.includes("column") ||
    text.includes("relation") ||
    text.includes("does not exist")
  );
}

function isActiveStatus(status: string | null | undefined): boolean {
  const normalized = String(status || "Active").trim().toLowerCase();
  return !["inactive", "resigned", "terminated", "terminate", "deactivated"].includes(normalized);
}

function normalizeModernEmployee(row: Record<string, unknown>): EmployeeRow {
  const raw = String(row.whatsapp_number_raw ?? "");
  const e164 = String(row.whatsapp_e164 ?? "") || normalizeBangladeshPhone(raw);
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    id: String(row.id),
    full_name: String(row.full_name ?? ""),
    designation: row.designation ? String(row.designation) : null,
    department: row.department ? String(row.department) : null,
    branch: row.branch ? String(row.branch) : null,
    whatsapp_number_raw: raw,
    whatsapp_e164: e164,
    tracking_enabled: Boolean(row.tracking_enabled),
    is_active: Boolean(row.is_active),
    status: String(row.status ?? "Active"),
    aliases,
    notes: row.notes ? String(row.notes) : null,
  };
}

function normalizeLegacyEmployee(row: Record<string, unknown>): EmployeeRow {
  const whatsappRaw = String(row.whatsapp_number ?? "");
  const normalized = normalizeBangladeshPhone(whatsappRaw);
  const status = String(row.status ?? "Active");

  return {
    id: String(row.id),
    full_name: String(row.full_name ?? ""),
    designation: row.designation ? String(row.designation) : null,
    department: row.department ? String(row.department) : null,
    branch: row.branch ? String(row.branch) : null,
    whatsapp_number_raw: whatsappRaw,
    whatsapp_e164: normalized,
    tracking_enabled: Boolean(row.is_active_for_tracking),
    is_active: isActiveStatus(status),
    status,
    aliases: [],
    notes: null,
  };
}

async function getEmployeesSchemaMode(): Promise<EmployeesSchemaMode> {
  if (cachedEmployeeSchema) return cachedEmployeeSchema;

  const probe = await supabaseAdmin.from("employees").select("whatsapp_e164").limit(1);
  if (!probe.error) {
    cachedEmployeeSchema = "modern";
    return cachedEmployeeSchema;
  }

  if (isMissingColumnOrTableError(probe.error)) {
    cachedEmployeeSchema = "legacy";
    return cachedEmployeeSchema;
  }

  throw new Error(probe.error.message || "Failed to detect employees schema mode");
}

async function hasTagTables(): Promise<boolean> {
  if (cachedTagSupport !== null) return cachedTagSupport;

  const probe = await supabaseAdmin.from("employee_tags").select("employee_id").limit(1);
  if (!probe.error) {
    cachedTagSupport = true;
    return true;
  }

  if (isMissingColumnOrTableError(probe.error)) {
    cachedTagSupport = false;
    return false;
  }

  cachedTagSupport = false;
  return false;
}

async function getBroadcastDeliverySchemaMode(): Promise<BroadcastDeliverySchemaMode> {
  if (cachedBroadcastDeliverySchema) return cachedBroadcastDeliverySchema;

  const probe = await supabaseAdmin
    .from("broadcast_deliveries")
    .select("last_status_at,status_payload")
    .limit(1);

  if (!probe.error) {
    cachedBroadcastDeliverySchema = "modern";
    return cachedBroadcastDeliverySchema;
  }

  if (isMissingColumnOrTableError(probe.error)) {
    cachedBroadcastDeliverySchema = "legacy";
    return cachedBroadcastDeliverySchema;
  }

  throw new Error(probe.error.message || "Failed to detect broadcast delivery schema mode");
}

async function getScheduleLabSchemaMode(): Promise<ScheduleLabSchemaMode> {
  if (cachedScheduleLabSchema) return cachedScheduleLabSchema;

  const probe = await supabaseAdmin
    .from("schedule_lab_entries")
    .select("id")
    .limit(1);

  if (!probe.error) {
    cachedScheduleLabSchema = "available";
    return cachedScheduleLabSchema;
  }

  if (isMissingColumnOrTableError(probe.error)) {
    cachedScheduleLabSchema = "missing";
    return cachedScheduleLabSchema;
  }

  throw new Error(probe.error.message || "Failed to detect schedule lab schema mode");
}

function legacyDeliveryStatus(status: BroadcastDeliveryLifecycleStatus): "sent" | "failed" {
  return status === "failed" ? "failed" : "sent";
}

async function fetchEmployees(options?: {
  ids?: string[];
  activeOnly?: boolean;
  trackingOnly?: boolean;
  orderByName?: boolean;
}): Promise<EmployeeRow[]> {
  const schema = await getEmployeesSchemaMode();
  const ids = options?.ids ?? [];
  const activeOnly = options?.activeOnly ?? false;
  const trackingOnly = options?.trackingOnly ?? false;
  const orderByName = options?.orderByName ?? false;

  if (schema === "modern") {
    let query = supabaseAdmin.from("employees").select(MODERN_EMPLOYEE_SELECT);
    if (ids.length > 0) query = query.in("id", ids);
    if (activeOnly) query = query.eq("is_active", true);
    if (trackingOnly) query = query.eq("tracking_enabled", true);
    if (orderByName) query = query.order("full_name", { ascending: true });

    const res = await query;
    ensureNoError(res.error, "Failed to load employees");
    return ((res.data ?? []) as Record<string, unknown>[]).map(normalizeModernEmployee);
  }

  let query = supabaseAdmin.from("employees").select(LEGACY_EMPLOYEE_SELECT);
  if (ids.length > 0) query = query.in("id", ids);
  if (trackingOnly) query = query.eq("is_active_for_tracking", true);
  if (orderByName) query = query.order("full_name", { ascending: true });

  const res = await query;
  ensureNoError(res.error, "Failed to load employees");

  let mapped = ((res.data ?? []) as Record<string, unknown>[]).map(normalizeLegacyEmployee);
  if (activeOnly) mapped = mapped.filter((row) => row.is_active);
  if (trackingOnly) mapped = mapped.filter((row) => row.tracking_enabled);
  return mapped;
}

export async function listEmployees() {
  const employees = await fetchEmployees({ orderByName: true });
  const tagsByEmployee = new Map<string, { key: string; label: string }[]>();

  if (await hasTagTables()) {
    const tagRes = await supabaseAdmin
      .from("employee_tags")
      .select("employee_id, tags!inner(key,label)");

    if (!tagRes.error) {
      for (const row of (tagRes.data ?? []) as EmployeeTagRow[]) {
        const list = tagsByEmployee.get(row.employee_id) ?? [];
        const tags = Array.isArray(row.tags) ? row.tags : row.tags ? [row.tags] : [];
        list.push(...tags);
        tagsByEmployee.set(row.employee_id, list);
      }
    }
  }

  return employees.map((employee) => ({
    ...employee,
    tags: tagsByEmployee.get(employee.id) ?? [],
  }));
}

export async function listTags() {
  const res = await supabaseAdmin
    .from("tags")
    .select("id,key,label")
    .order("label", { ascending: true });

  if (res.error && isMissingColumnOrTableError(res.error)) {
    return [
      { id: "sales_field", key: "sales_field", label: "Sales Field" },
      { id: "head_office", key: "head_office", label: "Head Office" },
      { id: "drivers", key: "drivers", label: "Drivers" },
      { id: "transport_manager", key: "transport_manager", label: "Transport Manager" },
    ];
  }

  ensureNoError(res.error, "Failed to load tags");
  return res.data ?? [];
}

export async function upsertTag(tag: { key: string; label: string }) {
  const res = await supabaseAdmin
    .from("tags")
    .upsert(
      {
        key: tag.key.trim().toLowerCase(),
        label: tag.label.trim(),
      },
      { onConflict: "key" },
    )
    .select("id,key,label")
    .single();

  ensureNoError(res.error, "Failed to upsert tag");
  return must(res.data, "Tag missing after upsert");
}

export async function upsertEmployee(input: UpsertEmployeeInput) {
  const normalized = normalizeBangladeshPhone(input.whatsappNumber);
  const schema = await getEmployeesSchemaMode();

  let res;
  if (schema === "modern") {
    const payload = {
      id: input.id,
      full_name: input.fullName.trim(),
      designation: input.designation?.trim() || null,
      department: input.department?.trim() || null,
      branch: input.branch?.trim() || null,
      whatsapp_number_raw: input.whatsappNumber,
      whatsapp_e164: normalized,
      tracking_enabled: input.trackingEnabled,
      is_active: input.isActive,
      status: input.status?.trim() || "Active",
      aliases: input.aliases?.map((item) => item.trim()).filter(Boolean) ?? [],
      notes: input.notes?.trim() || null,
    };

    res = await supabaseAdmin
      .from("employees")
      .upsert(payload, { onConflict: "whatsapp_e164" })
      .select("id")
      .single();
  } else {
    const payload = {
      id: input.id,
      full_name: input.fullName.trim(),
      designation: input.designation?.trim() || null,
      department: input.department?.trim() || null,
      branch: input.branch?.trim() || null,
      whatsapp_number: normalized.replace(/^\+/, ""),
      is_active_for_tracking: input.trackingEnabled,
      status: input.isActive ? (input.status?.trim() || "Active") : "Inactive",
    };

    res = await supabaseAdmin
      .from("employees")
      .upsert(payload, { onConflict: "whatsapp_number" })
      .select("id")
      .single();
  }

  ensureNoError(res.error, "Failed to upsert employee");
  const employeeId = must(res.data?.id, "Employee id missing after upsert");

  if (input.tagKeys && (await hasTagTables())) {
    await supabaseAdmin.from("employee_tags").delete().eq("employee_id", employeeId);

    if (input.tagKeys.length > 0) {
      const rows = input.tagKeys.map((key) => ({ employee_id: employeeId, tag_key: key }));
      const tagsInsert = await supabaseAdmin.from("employee_tags").insert(rows);
      ensureNoError(tagsInsert.error, "Failed to assign employee tags");
    }
  }

  return employeeId;
}

export async function deleteEmployee(employeeId: string) {
  const schema = await getEmployeesSchemaMode();

  if (schema === "modern") {
    const res = await supabaseAdmin
      .from("employees")
      .delete()
      .eq("id", employeeId);
    ensureNoError(res.error, "Failed to delete employee");
    return;
  }

  const res = await supabaseAdmin
    .from("employees")
    .delete()
    .eq("id", employeeId);
  ensureNoError(res.error, "Failed to delete employee");
}

export async function updateEmployeesTrackingBulk(input: {
  employeeIds: string[];
  trackingEnabled: boolean;
}) {
  const ids = Array.from(new Set(input.employeeIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return { updated: 0 };

  const schema = await getEmployeesSchemaMode();

  if (schema === "modern") {
    const res = await supabaseAdmin
      .from("employees")
      .update({ tracking_enabled: input.trackingEnabled })
      .in("id", ids);
    ensureNoError(res.error, "Failed to bulk update tracking");
    return { updated: ids.length };
  }

  const res = await supabaseAdmin
    .from("employees")
    .update({ is_active_for_tracking: input.trackingEnabled })
    .in("id", ids);
  ensureNoError(res.error, "Failed to bulk update tracking");
  return { updated: ids.length };
}

export async function getTrackedEmployees(): Promise<EmployeeRow[]> {
  if (!(await hasTagTables())) {
    return fetchEmployees({
      trackingOnly: true,
      activeOnly: true,
      orderByName: true,
    });
  }

  const tagged = await supabaseAdmin
    .from("employee_tags")
    .select("employee_id")
    .eq("tag_key", TRACKING_TAG_KEY);

  ensureNoError(tagged.error, "Failed to load tracked tag mappings");

  const ids = (tagged.data ?? []).map((row) => row.employee_id as string);
  if (ids.length === 0) return [];

  return fetchEmployees({
    ids,
    trackingOnly: true,
    activeOnly: true,
    orderByName: true,
  });
}

export type ScheduleLabEntry = {
  id: string;
  label: string;
  minuteOfDay: number;
  timeHHmm: string;
  bodyText: string;
  templateName: string;
  languageCode: string;
  isActive: boolean;
  legacySlotKey: LegacySlotKey | null;
  reportSlotKey: ReportSlotKey | null;
  reportMandatory: boolean;
  reportCritical: boolean;
  reportWeight: number;
  createdAt: string;
  updatedAt: string;
};

export type ReportSlotPolicy = {
  slotKey: ReportSlotKey;
  label: string;
  mandatory: boolean;
  critical: boolean;
  weight: number;
  minuteOfDay: number;
};

const LEGACY_DEFAULT_REPORT_POLICIES: ReportSlotPolicy[] = [
  { slotKey: "morning", label: "Morning", mandatory: false, critical: false, weight: 0, minuteOfDay: 8 * 60 },
  { slotKey: "noon", label: "Noon", mandatory: true, critical: false, weight: 1, minuteOfDay: 12 * 60 },
  { slotKey: "afternoon", label: "Afternoon", mandatory: true, critical: true, weight: 2.5, minuteOfDay: 15 * 60 },
  { slotKey: "evening", label: "Evening", mandatory: true, critical: true, weight: 3, minuteOfDay: 17 * 60 + 30 },
];

function minuteToHHmm(minute: number): string {
  const safe = Math.max(0, Math.min(1439, Math.floor(minute)));
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeLegacySlotKeyNullable(value: unknown): LegacySlotKey | null {
  const text = String(value ?? "").trim();
  if (text === "morning" || text === "noon" || text === "afternoon" || text === "evening") return text;
  return null;
}

function normalizeReportSlotKeyNullable(value: unknown): ReportSlotKey | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  return text;
}

function normalizeReportWeight(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  if (numeric < 0) return 0;
  return Number(numeric.toFixed(2));
}

function mapScheduleLabRow(row: Record<string, unknown>): ScheduleLabEntry {
  const minuteOfDay = Number(row.minute_of_day ?? 0);
  const reportSlotKey = normalizeReportSlotKeyNullable(row.report_slot_key);
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    minuteOfDay,
    timeHHmm: minuteToHHmm(minuteOfDay),
    bodyText: String(row.body_text ?? ""),
    templateName: String(row.template_name ?? env.WHATSAPP_SCHEDULED_TEMPLATE_NAME),
    languageCode: String(row.language_code ?? "en"),
    isActive: Boolean(row.is_active),
    legacySlotKey: normalizeLegacySlotKeyNullable(row.legacy_slot_key),
    reportSlotKey,
    reportMandatory: Boolean(row.report_mandatory),
    reportCritical: Boolean(row.report_critical),
    reportWeight: reportSlotKey ? normalizeReportWeight(row.report_weight) : 0,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const SCHEDULE_LAB_SELECT =
  "id,label,minute_of_day,body_text,template_name,language_code,is_active,legacy_slot_key,report_slot_key,report_mandatory,report_critical,report_weight,created_at,updated_at";

export async function listScheduleLabEntries(): Promise<ScheduleLabEntry[]> {
  const mode = await getScheduleLabSchemaMode();
  if (mode === "missing") {
    throw new Error("schedule_lab_entries table is missing. Run migration 0005_schedule_lab.sql first.");
  }

  const res = await supabaseAdmin
    .from("schedule_lab_entries")
    .select(SCHEDULE_LAB_SELECT)
    .order("minute_of_day", { ascending: true })
    .order("created_at", { ascending: true });

  ensureNoError(res.error, "Failed to list schedule lab entries");
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapScheduleLabRow);
}

export async function isScheduleLabReady(): Promise<boolean> {
  return (await getScheduleLabSchemaMode()) === "available";
}

type UpsertScheduleLabInput = {
  label: string;
  minuteOfDay: number;
  bodyText: string;
  templateName: string;
  languageCode: string;
  isActive: boolean;
  legacySlotKey: LegacySlotKey | null;
  reportSlotKey: ReportSlotKey | null;
  reportMandatory: boolean;
  reportCritical: boolean;
  reportWeight: number;
};

function normalizeScheduleLabPayload(input: UpsertScheduleLabInput) {
  const reportSlotKey = normalizeReportSlotKeyNullable(input.reportSlotKey);
  const reportMandatory = reportSlotKey ? input.reportMandatory : false;
  const reportCritical = reportSlotKey ? input.reportCritical : false;
  const reportWeight = reportSlotKey
    ? normalizeReportWeight(input.reportWeight)
    : 0;

  if (reportCritical && !reportMandatory) {
    throw new Error("Critical schedule must also be marked mandatory.");
  }

  return {
    label: input.label.trim(),
    minute_of_day: Math.max(0, Math.min(1439, Math.floor(input.minuteOfDay))),
    body_text: input.bodyText.trim(),
    template_name: input.templateName.trim() || env.WHATSAPP_SCHEDULED_TEMPLATE_NAME,
    language_code: input.languageCode.trim() || "en",
    is_active: input.isActive,
    legacy_slot_key: normalizeLegacySlotKeyNullable(input.legacySlotKey),
    report_slot_key: reportSlotKey,
    report_mandatory: reportMandatory,
    report_critical: reportCritical,
    report_weight: reportWeight,
  };
}

export async function createScheduleLabEntry(input: UpsertScheduleLabInput): Promise<ScheduleLabEntry> {
  const mode = await getScheduleLabSchemaMode();
  if (mode === "missing") {
    throw new Error("schedule_lab_entries table is missing. Run migration 0005_schedule_lab.sql first.");
  }

  const payload = normalizeScheduleLabPayload(input);
  const res = await supabaseAdmin
    .from("schedule_lab_entries")
    .insert(payload)
    .select(SCHEDULE_LAB_SELECT)
    .single();

  ensureNoError(res.error, "Failed to create schedule lab entry");
  return mapScheduleLabRow(must(res.data as Record<string, unknown> | null, "Schedule row missing after insert"));
}

export async function updateScheduleLabEntry(
  id: string,
  patch: Partial<UpsertScheduleLabInput>,
): Promise<ScheduleLabEntry> {
  const mode = await getScheduleLabSchemaMode();
  if (mode === "missing") {
    throw new Error("schedule_lab_entries table is missing. Run migration 0005_schedule_lab.sql first.");
  }

  const currentRes = await supabaseAdmin
    .from("schedule_lab_entries")
    .select(SCHEDULE_LAB_SELECT)
    .eq("id", id)
    .maybeSingle();

  ensureNoError(currentRes.error, "Failed to load schedule lab entry");
  const current = currentRes.data as Record<string, unknown> | null;
  if (!current) throw new Error("Schedule not found");

  const mergedInput: UpsertScheduleLabInput = {
    label: patch.label ?? String(current.label ?? ""),
    minuteOfDay: patch.minuteOfDay ?? Number(current.minute_of_day ?? 0),
    bodyText: patch.bodyText ?? String(current.body_text ?? ""),
    templateName: patch.templateName ?? String(current.template_name ?? env.WHATSAPP_SCHEDULED_TEMPLATE_NAME),
    languageCode: patch.languageCode ?? String(current.language_code ?? "en"),
    isActive: patch.isActive ?? Boolean(current.is_active),
    legacySlotKey: patch.legacySlotKey === undefined
      ? normalizeLegacySlotKeyNullable(current.legacy_slot_key)
      : patch.legacySlotKey,
    reportSlotKey: patch.reportSlotKey === undefined
      ? normalizeReportSlotKeyNullable(current.report_slot_key)
      : patch.reportSlotKey,
    reportMandatory: patch.reportMandatory ?? Boolean(current.report_mandatory),
    reportCritical: patch.reportCritical ?? Boolean(current.report_critical),
    reportWeight: patch.reportWeight ?? normalizeReportWeight(current.report_weight),
  };

  const payload = normalizeScheduleLabPayload(mergedInput);

  const res = await supabaseAdmin
    .from("schedule_lab_entries")
    .update(payload)
    .eq("id", id)
    .select(SCHEDULE_LAB_SELECT)
    .single();

  ensureNoError(res.error, "Failed to update schedule lab entry");
  return mapScheduleLabRow(must(res.data as Record<string, unknown> | null, "Schedule row missing after update"));
}

export async function deleteScheduleLabEntry(id: string): Promise<void> {
  const mode = await getScheduleLabSchemaMode();
  if (mode === "missing") {
    throw new Error("schedule_lab_entries table is missing. Run migration 0005_schedule_lab.sql first.");
  }

  const res = await supabaseAdmin
    .from("schedule_lab_entries")
    .delete()
    .eq("id", id);

  ensureNoError(res.error, "Failed to delete schedule lab entry");
}

export async function listDueActiveScheduleLabEntries(
  minuteOfDay: number,
  graceMinutes = 0,
): Promise<ScheduleLabEntry[]> {
  const mode = await getScheduleLabSchemaMode();
  if (mode === "missing") return [];

  const current = Math.max(0, Math.min(1439, Math.floor(minuteOfDay)));
  const grace = Math.max(0, Math.floor(graceMinutes));

  let query = supabaseAdmin
    .from("schedule_lab_entries")
    .select(SCHEDULE_LAB_SELECT)
    .eq("is_active", true);

  // With a grace window we fire anything due in the last `grace` minutes (per-day
  // job_key dedup prevents re-sends); otherwise require an exact minute match.
  query = grace > 0
    ? query.gte("minute_of_day", Math.max(0, current - grace)).lte("minute_of_day", current)
    : query.eq("minute_of_day", current);

  const res = await query.order("created_at", { ascending: true });

  ensureNoError(res.error, "Failed to list due schedule lab entries");
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapScheduleLabRow);
}

export async function getScheduleLabEntryByLegacySlot(
  slotKey: LegacySlotKey,
  options?: { includeInactive?: boolean },
): Promise<ScheduleLabEntry | null> {
  const mode = await getScheduleLabSchemaMode();
  if (mode === "missing") return null;

  let query = supabaseAdmin
    .from("schedule_lab_entries")
    .select(SCHEDULE_LAB_SELECT)
    .eq("legacy_slot_key", slotKey)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  }

  const res = await query;

  ensureNoError(res.error, "Failed to load schedule entry by legacy slot");
  const row = (res.data ?? [])[0];
  return row ? mapScheduleLabRow(row as Record<string, unknown>) : null;
}

export async function listActiveReportSlotPolicies(): Promise<ReportSlotPolicy[]> {
  const mode = await getScheduleLabSchemaMode();
  if (mode === "missing") {
    return LEGACY_DEFAULT_REPORT_POLICIES;
  }

  const res = await supabaseAdmin
    .from("schedule_lab_entries")
    .select("label,report_slot_key,report_mandatory,report_critical,report_weight,minute_of_day,created_at")
    .eq("is_active", true)
    .not("report_slot_key", "is", null)
    .order("minute_of_day", { ascending: true })
    .order("created_at", { ascending: true });

  ensureNoError(res.error, "Failed to list active report slot policies");

  const unique = new Map<string, ReportSlotPolicy>();
  for (const row of (res.data ?? []) as Record<string, unknown>[]) {
    const slotKey = normalizeReportSlotKeyNullable(row.report_slot_key);
    if (!slotKey || unique.has(slotKey)) continue;

    unique.set(slotKey, {
      slotKey,
      label: String(row.label ?? slotKey).trim() || slotKey,
      mandatory: Boolean(row.report_mandatory),
      critical: Boolean(row.report_critical),
      weight: normalizeReportWeight(row.report_weight),
      minuteOfDay: Math.max(0, Math.min(1439, Number(row.minute_of_day ?? 0))),
    });
  }

  return Array.from(unique.values());
}

export async function getTemplateBySlot(
  slotKey: LegacySlotKey,
  options?: { includeInactive?: boolean },
): Promise<{
  slot_key: LegacySlotKey;
  template_name: string;
  language_code: string;
} | null> {
  let query = supabaseAdmin
    .from("message_templates")
    .select("slot_key,template_name,language_code,is_active,updated_at")
    .eq("slot_key", slotKey);

  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  } else {
    query = query.order("is_active", { ascending: false }).order("updated_at", { ascending: false }).limit(1);
  }

  const res = await query.maybeSingle();

  ensureNoError(res.error, "Failed to fetch slot template");
  return (res.data as { slot_key: LegacySlotKey; template_name: string; language_code: string } | null) ?? null;
}

export async function getEmployeesByIds(ids: string[]): Promise<EmployeeRow[]> {
  if (ids.length === 0) return [];
  return fetchEmployees({ ids, activeOnly: true });
}

export async function getEmployeesByTagKeys(tagKeys: string[]): Promise<EmployeeRow[]> {
  if (tagKeys.length === 0) return [];
  if (!(await hasTagTables())) return [];

  const mapRes = await supabaseAdmin
    .from("employee_tags")
    .select("employee_id")
    .in("tag_key", tagKeys);

  ensureNoError(mapRes.error, "Failed to load employee tags");
  const ids = Array.from(new Set((mapRes.data ?? []).map((row) => row.employee_id as string)));

  return getEmployeesByIds(ids);
}

export async function findEmployeeByWhatsAppFrom(fromValue: string): Promise<EmployeeRow | null> {
  const normalized = normalizeBangladeshPhone(fromValue);
  const schema = await getEmployeesSchemaMode();

  if (schema === "modern") {
    const res = await supabaseAdmin
      .from("employees")
      .select(MODERN_EMPLOYEE_SELECT)
      .eq("whatsapp_e164", normalized)
      .maybeSingle();

    ensureNoError(res.error, "Failed to find employee by WhatsApp");
    return res.data ? normalizeModernEmployee(res.data as Record<string, unknown>) : null;
  }

  const digits = normalized.replace(/^\+/, "");
  const local = digits.startsWith("880") && digits.length >= 13 ? `0${digits.slice(3, 13)}` : digits;
  const candidates = Array.from(new Set([digits, local, String(fromValue).replace(/\D+/g, "")])).filter(Boolean);

  const res = await supabaseAdmin
    .from("employees")
    .select(LEGACY_EMPLOYEE_SELECT)
    .in("whatsapp_number", candidates)
    .limit(1)
    .maybeSingle();

  ensureNoError(res.error, "Failed to find employee by WhatsApp");
  return res.data ? normalizeLegacyEmployee(res.data as Record<string, unknown>) : null;
}

export async function insertMessageEvent(input: {
  employeeId: string | null;
  direction: "inbound" | "outbound";
  category: string;
  slotKey?: SlotKey | null;
  trackingDate?: string | null;
  whatsappMessageId?: string | null;
  payload: Record<string, unknown>;
  messageText?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  receivedAt?: string;
}) {
  const res = await supabaseAdmin.from("message_events").insert({
    employee_id: input.employeeId,
    direction: input.direction,
    category: input.category,
    slot_key: input.slotKey ?? null,
    tracking_date: input.trackingDate ?? null,
    whatsapp_message_id: input.whatsappMessageId ?? null,
    message_text: input.messageText ?? null,
    location_lat: input.locationLat ?? null,
    location_lng: input.locationLng ?? null,
    payload: input.payload,
    occurred_at: input.receivedAt ?? new Date().toISOString(),
  });

  ensureNoError(res.error, "Failed to insert message event");
}

export type MessageEventLink = {
  employeeId: string | null;
  direction: "inbound" | "outbound";
  category: string;
  slotKey: SlotKey | null;
  trackingDate: string | null;
  whatsappMessageId: string | null;
  occurredAt: string;
};

function mapMessageEventLink(row: Record<string, unknown>): MessageEventLink {
  const direction = row.direction === "inbound" ? "inbound" : "outbound";
  return {
    employeeId: row.employee_id ? String(row.employee_id) : null,
    direction,
    category: String(row.category ?? ""),
    slotKey: row.slot_key ? (String(row.slot_key) as SlotKey) : null,
    trackingDate: row.tracking_date ? String(row.tracking_date) : null,
    whatsappMessageId: row.whatsapp_message_id ? String(row.whatsapp_message_id) : null,
    occurredAt: row.occurred_at ? String(row.occurred_at) : new Date().toISOString(),
  };
}

export async function findMessageEventByWhatsAppMessageId(
  whatsappMessageId: string,
): Promise<MessageEventLink | null> {
  const normalized = whatsappMessageId.trim();
  if (!normalized) return null;

  const res = await supabaseAdmin
    .from("message_events")
    .select("employee_id,direction,category,slot_key,tracking_date,whatsapp_message_id,occurred_at")
    .eq("whatsapp_message_id", normalized)
    .order("occurred_at", { ascending: false })
    .limit(1);

  ensureNoError(res.error, "Failed to find message event by WhatsApp message id");
  const row = (res.data ?? [])[0];
  return row ? mapMessageEventLink(row as Record<string, unknown>) : null;
}

export async function listRecentOutboundPromptEventsForEmployee(input: {
  employeeId: string;
  occurredBefore: string;
  lookbackHours?: number;
}): Promise<MessageEventLink[]> {
  const lookbackHours = Math.min(Math.max(input.lookbackHours ?? 18, 1), 72);
  const beforeDate = new Date(input.occurredBefore);
  const beforeMs = Number.isNaN(beforeDate.getTime()) ? Date.now() : beforeDate.getTime();
  const afterIso = new Date(beforeMs - lookbackHours * 60 * 60 * 1000).toISOString();
  const beforeIso = new Date(beforeMs).toISOString();

  const res = await supabaseAdmin
    .from("message_events")
    .select("employee_id,direction,category,slot_key,tracking_date,whatsapp_message_id,occurred_at")
    .eq("employee_id", input.employeeId)
    .eq("direction", "outbound")
    .in("category", ["scheduled_prompt", "ceo_broadcast_template"])
    .gte("occurred_at", afterIso)
    .lte("occurred_at", beforeIso)
    .order("occurred_at", { ascending: false })
    .limit(20);

  ensureNoError(res.error, "Failed to list recent outbound prompt events");
  return (res.data ?? []).map((row) => mapMessageEventLink(row as Record<string, unknown>));
}

export async function listRecentInboundClassifiedRepliesForEmployee(input: {
  employeeId: string;
  occurredBefore: string;
  lookbackMinutes?: number;
}): Promise<MessageEventLink[]> {
  const lookbackMinutes = Math.min(Math.max(input.lookbackMinutes ?? 45, 1), 240);
  const beforeDate = new Date(input.occurredBefore);
  const beforeMs = Number.isNaN(beforeDate.getTime()) ? Date.now() : beforeDate.getTime();
  const afterIso = new Date(beforeMs - lookbackMinutes * 60 * 1000).toISOString();
  const beforeIso = new Date(beforeMs).toISOString();

  const res = await supabaseAdmin
    .from("message_events")
    .select("employee_id,direction,category,slot_key,tracking_date,whatsapp_message_id,occurred_at")
    .eq("employee_id", input.employeeId)
    .eq("direction", "inbound")
    .in("category", ["scheduled_reply", "broadcast_reply"])
    .gte("occurred_at", afterIso)
    .lte("occurred_at", beforeIso)
    .order("occurred_at", { ascending: false })
    .limit(8);

  ensureNoError(res.error, "Failed to list recent inbound classified replies");
  return (res.data ?? []).map((row) => mapMessageEventLink(row as Record<string, unknown>));
}

// Returns the subset of employee ids that have sent an inbound message within
// the WhatsApp customer-service window, meaning we may reply with free-form text
// (no template, no marketing frequency cap).
export async function getEmployeesWithOpenServiceWindow(
  employeeIds: string[],
  windowHours = 24,
): Promise<Set<string>> {
  const open = new Set<string>();
  if (employeeIds.length === 0) return open;

  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const res = await supabaseAdmin
    .from("message_events")
    .select("employee_id")
    .eq("direction", "inbound")
    .in("employee_id", employeeIds)
    .gte("occurred_at", sinceIso);

  ensureNoError(res.error, "Failed to load service-window inbound events");
  for (const row of res.data ?? []) {
    const id = (row as { employee_id?: string | null }).employee_id;
    if (id) open.add(id);
  }
  return open;
}

type JsonMap = Record<string, unknown>;

function asJsonMap(value: unknown): JsonMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonMap;
}

function extractUnknownSenderFromPayload(payload: JsonMap): string | null {
  // Compact (trimmed) inbound payloads store the sender at the top level.
  const directFrom = payload.from;
  if (typeof directFrom === "string" && directFrom.trim()) return directFrom.trim();

  // Legacy rows stored the full webhook envelope.
  const directMessages = payload.messages;
  if (Array.isArray(directMessages)) {
    const from = asJsonMap(directMessages[0]).from;
    if (typeof from === "string" && from.trim()) return from.trim();
  }

  const entries = payload.entry;
  if (!Array.isArray(entries)) return null;

  for (const entry of entries) {
    const changes = asJsonMap(entry).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = asJsonMap(change).value;
      const messages = asJsonMap(value).messages;
      if (!Array.isArray(messages)) continue;

      for (const message of messages) {
        const from = asJsonMap(message).from;
        if (typeof from === "string" && from.trim()) return from.trim();
      }
    }
  }

  return null;
}

function extractFailureReason(payload: JsonMap): string | null {
  const errors = payload.errors;
  if (Array.isArray(errors)) {
    const first = asJsonMap(errors[0]);
    const value = first.message ?? first.title ?? first.details;
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const error = asJsonMap(payload.error);
  const fallback = error.message ?? error.title ?? error.details;
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return null;
}

export type ConversationMessageEvent = {
  id: string;
  employeeId: string | null;
  direction: "inbound" | "outbound";
  category: string;
  slotKey: SlotKey | null;
  trackingDate: string | null;
  whatsappMessageId: string | null;
  messageText: string | null;
  occurredAt: string;
  unknownSender: string | null;
  replyContextMessageId: string | null;
  linkedOutboundMessageId: string | null;
  linkedOutboundCategory: string | null;
  classificationReason: string | null;
  failureReason: string | null;
};

function mapConversationMessageEvent(row: Record<string, unknown>): ConversationMessageEvent {
  const payload = asJsonMap(row.payload);
  const direction = row.direction === "inbound" ? "inbound" : "outbound";

  return {
    id: String(row.id ?? ""),
    employeeId: row.employee_id ? String(row.employee_id) : null,
    direction,
    category: String(row.category ?? ""),
    slotKey: row.slot_key ? (String(row.slot_key) as SlotKey) : null,
    trackingDate: row.tracking_date ? String(row.tracking_date) : null,
    whatsappMessageId: row.whatsapp_message_id ? String(row.whatsapp_message_id) : null,
    messageText: row.message_text ? String(row.message_text) : null,
    occurredAt: row.occurred_at ? String(row.occurred_at) : new Date().toISOString(),
    unknownSender: extractUnknownSenderFromPayload(payload),
    replyContextMessageId: typeof payload._reply_context_message_id === "string"
      ? payload._reply_context_message_id
      : null,
    linkedOutboundMessageId: typeof payload._reply_linked_outbound_message_id === "string"
      ? payload._reply_linked_outbound_message_id
      : null,
    linkedOutboundCategory: typeof payload._reply_linked_outbound_category === "string"
      ? payload._reply_linked_outbound_category
      : null,
    classificationReason: typeof payload._reply_classification_reason === "string"
      ? payload._reply_classification_reason
      : null,
    failureReason: extractFailureReason(payload),
  };
}

export async function listConversationMessageEvents(limit = 800): Promise<ConversationMessageEvent[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 1000);
  const res = await supabaseAdmin
    .from("message_events")
    .select("id,employee_id,direction,category,slot_key,tracking_date,whatsapp_message_id,message_text,payload,occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(safeLimit);

  ensureNoError(res.error, "Failed to list conversation message events");
  return (res.data ?? []).map((row) => mapConversationMessageEvent(row as Record<string, unknown>));
}

export async function deleteConversationMessageEventsByIds(eventIds: string[]): Promise<number> {
  const ids = Array.from(new Set(eventIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return 0;

  const chunkSize = 400;
  let deleted = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const res = await supabaseAdmin
      .from("message_events")
      .delete()
      .in("id", batch);

    ensureNoError(res.error, "Failed to delete conversation events");
    deleted += batch.length;
  }

  return deleted;
}

function buildMergedText(previous: string | null, incoming: string): string {
  if (!previous || !previous.trim()) return incoming;
  return `${previous.trim()}\n---\n${incoming.trim()}`;
}

export async function mergeSlotResponse(input: {
  employeeId: string;
  trackingDate: string;
  slotKey: SlotKey;
  replyAt: string;
  mergedFragment: string;
}) {
  const existing = await supabaseAdmin
    .from("slot_responses")
    .select("id,merged_text,reply_count,first_reply_at,last_reply_at")
    .eq("employee_id", input.employeeId)
    .eq("tracking_date", input.trackingDate)
    .eq("slot_key", input.slotKey)
    .maybeSingle();

  ensureNoError(existing.error, "Failed to read slot response");

  if (!existing.data) {
    const insertRes = await supabaseAdmin.from("slot_responses").insert({
      employee_id: input.employeeId,
      tracking_date: input.trackingDate,
      slot_key: input.slotKey,
      merged_text: input.mergedFragment,
      reply_count: 1,
      is_missing: false,
      first_reply_at: input.replyAt,
      last_reply_at: input.replyAt,
    });

    ensureNoError(insertRes.error, "Failed to insert slot response");
    return;
  }

  const updateRes = await supabaseAdmin
    .from("slot_responses")
    .update({
      merged_text: buildMergedText(existing.data.merged_text, input.mergedFragment),
      reply_count: (existing.data.reply_count ?? 0) + 1,
      last_reply_at: input.replyAt,
      is_missing: false,
    })
    .eq("id", existing.data.id);

  ensureNoError(updateRes.error, "Failed to update slot response");
}

export async function markMissingForSlot(params: {
  trackingDate: string;
  slotKey: SlotKey;
  employeeIds: string[];
}) {
  if (params.employeeIds.length === 0) return;

  const existing = await supabaseAdmin
    .from("slot_responses")
    .select("employee_id")
    .eq("tracking_date", params.trackingDate)
    .eq("slot_key", params.slotKey)
    .in("employee_id", params.employeeIds);

  ensureNoError(existing.error, "Failed to load existing slot responses");

  const existingSet = new Set((existing.data ?? []).map((row) => row.employee_id as string));
  const missingIds = params.employeeIds.filter((id) => !existingSet.has(id));

  if (missingIds.length === 0) return;

  const rows = missingIds.map((employeeId) => ({
    employee_id: employeeId,
    tracking_date: params.trackingDate,
    slot_key: params.slotKey,
    merged_text: null,
    reply_count: 0,
    is_missing: true,
  }));

  const insertRes = await supabaseAdmin.from("slot_responses").insert(rows);
  ensureNoError(insertRes.error, "Failed to insert missing slot rows");
}

export async function createJobRun(jobType: string, jobKey: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await supabaseAdmin.from("job_runs").insert({
    job_type: jobType,
    job_key: jobKey,
    payload,
  });

  if (!res.error) return true;

  if ((res.error as { code?: string }).code === "23505") {
    return false;
  }

  throw new Error(res.error.message || "Failed to create job run");
}

export async function completeJobRun(jobKey: string, status: "success" | "failed", note?: string) {
  const res = await supabaseAdmin
    .from("job_runs")
    .update({ status, note: note ?? null, finished_at: new Date().toISOString() })
    .eq("job_key", jobKey);

  ensureNoError(res.error, "Failed to complete job run");
}

export async function createBroadcastCampaign(input: {
  creatorType: string;
  originalMessage: string;
  finalMessage: string;
  audienceType: string;
  recipientCount: number;
}) {
  const res = await supabaseAdmin
    .from("broadcast_campaigns")
    .insert({
      creator_type: input.creatorType,
      original_message: input.originalMessage,
      final_message: input.finalMessage,
      audience_type: input.audienceType,
      recipient_count: input.recipientCount,
    })
    .select("id")
    .single();

  ensureNoError(res.error, "Failed to create broadcast campaign");
  return must(res.data?.id, "Campaign id missing");
}

export async function insertBroadcastDelivery(input: {
  campaignId: string;
  employeeId: string;
  whatsappMessageId?: string | null;
  status: BroadcastDeliveryLifecycleStatus;
  failureReason?: string | null;
  lastStatusAt?: string | null;
  statusPayload?: Record<string, unknown>;
}) {
  const mode = await getBroadcastDeliverySchemaMode();

  const res = mode === "modern"
    ? await supabaseAdmin.from("broadcast_deliveries").insert({
      campaign_id: input.campaignId,
      employee_id: input.employeeId,
      whatsapp_message_id: input.whatsappMessageId ?? null,
      status: input.status,
      failure_reason: input.failureReason ?? null,
      last_status_at: input.lastStatusAt ?? new Date().toISOString(),
      status_payload: input.statusPayload ?? {},
    })
    : await supabaseAdmin.from("broadcast_deliveries").insert({
      campaign_id: input.campaignId,
      employee_id: input.employeeId,
      whatsapp_message_id: input.whatsappMessageId ?? null,
      status: legacyDeliveryStatus(input.status),
      failure_reason: input.failureReason ?? null,
    });

  ensureNoError(res.error, "Failed to insert broadcast delivery");
}

function statusRank(status: BroadcastDeliveryLifecycleStatus): number {
  if (status === "accepted") return 1;
  if (status === "sent") return 2;
  if (status === "delivered") return 3;
  if (status === "read") return 4;
  return 5;
}

export async function updateBroadcastDeliveryStatusByMessageId(input: {
  whatsappMessageId: string;
  status: BroadcastDeliveryLifecycleStatus;
  failureReason?: string | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown>;
}) {
  const mode = await getBroadcastDeliverySchemaMode();
  const existing = await supabaseAdmin
    .from("broadcast_deliveries")
    .select("id,campaign_id,employee_id,status")
    .eq("whatsapp_message_id", input.whatsappMessageId)
    .maybeSingle();

  ensureNoError(existing.error, "Failed to load broadcast delivery by message id");

  if (!existing.data?.id) {
    return {
      updated: false,
      deliveryId: null as string | null,
      campaignId: null as string | null,
      employeeId: null as string | null,
    };
  }

  const currentStatus = existing.data.status as BroadcastDeliveryLifecycleStatus;
  const shouldUpdate =
    input.status === "failed" ||
    statusRank(input.status) >= statusRank(currentStatus);

  if (shouldUpdate) {
    const updateRes = mode === "modern"
      ? await supabaseAdmin
        .from("broadcast_deliveries")
        .update({
          status: input.status,
          failure_reason: input.failureReason ?? null,
          last_status_at: input.occurredAt ?? new Date().toISOString(),
          status_payload: input.payload ?? {},
        })
        .eq("id", existing.data.id)
      : await supabaseAdmin
        .from("broadcast_deliveries")
        .update({
          status: legacyDeliveryStatus(input.status),
          failure_reason: input.failureReason ?? null,
        })
        .eq("id", existing.data.id);

    ensureNoError(updateRes.error, "Failed to update broadcast delivery status");
  }

  return {
    updated: shouldUpdate,
    deliveryId: existing.data.id as string,
    campaignId: existing.data.campaign_id as string | null,
    employeeId: existing.data.employee_id as string | null,
  };
}

export async function insertBroadcastDeliveryEvent(input: {
  deliveryId?: string | null;
  campaignId?: string | null;
  employeeId?: string | null;
  whatsappMessageId: string;
  status: BroadcastDeliveryLifecycleStatus;
  failureReason?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: string | null;
}) {
  const res = await supabaseAdmin.from("broadcast_delivery_events").insert({
    delivery_id: input.deliveryId ?? null,
    campaign_id: input.campaignId ?? null,
    employee_id: input.employeeId ?? null,
    whatsapp_message_id: input.whatsappMessageId,
    status: input.status,
    failure_reason: input.failureReason ?? null,
    payload: input.payload ?? {},
    occurred_at: input.occurredAt ?? new Date().toISOString(),
  });

  ensureNoError(res.error, "Failed to insert broadcast delivery event");
}

export async function insertMentionAudit(input: {
  messageBody: string;
  extractedNames: string[];
  resolvedEmployeeIds: string[];
  unresolvedNames: string[];
}) {
  const res = await supabaseAdmin.from("mention_resolution_audit").insert({
    message_body: input.messageBody,
    extracted_names: input.extractedNames,
    resolved_employee_ids: input.resolvedEmployeeIds,
    unresolved_names: input.unresolvedNames,
  });

  ensureNoError(res.error, "Failed to insert mention audit");
}

export async function insertReport(input: {
  kind: ReportKind;
  reportDate: string;
  employeeId?: string | null;
  title: string;
  metrics: Record<string, unknown>;
  narrative: string;
  modelName: string;
}) {
  const res = await supabaseAdmin.from("reports").insert({
    kind: input.kind,
    report_date: input.reportDate,
    employee_id: input.employeeId ?? null,
    title: input.title,
    metrics: input.metrics,
    narrative: input.narrative,
    model_name: input.modelName,
  });

  ensureNoError(res.error, "Failed to insert report");
}

export async function deleteReportsByDateAndKinds(reportDate: string, kinds: ReportKind[]) {
  if (kinds.length === 0) return;

  const res = await supabaseAdmin
    .from("reports")
    .delete()
    .eq("report_date", reportDate)
    .in("kind", kinds);

  ensureNoError(res.error, "Failed to delete existing reports");
}

export async function listReports(
  options:
    | number
    | {
        limit?: number;
        kind?: ReportKind | "all";
        fromDate?: string;
        toDate?: string;
      } = 40,
) {
  const limit = typeof options === "number" ? options : (options.limit ?? 40);
  const kind = typeof options === "number" ? "all" : (options.kind ?? "all");
  const fromDate = typeof options === "number" ? undefined : options.fromDate;
  const toDate = typeof options === "number" ? undefined : options.toDate;

  let query = supabaseAdmin
    .from("reports")
    .select("id,kind,report_date,title,narrative,metrics,model_name,created_at,employees:employee_id(full_name)")
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (kind !== "all") query = query.eq("kind", kind);
  if (fromDate) query = query.gte("report_date", fromDate);
  if (toDate) query = query.lte("report_date", toDate);
  query = query.limit(Math.min(Math.max(limit, 1), 300));

  const res = await query;

  ensureNoError(res.error, "Failed to list reports");
  return res.data ?? [];
}

export async function listRecentBroadcastCampaigns(limit = 25) {
  const campaignsRes = await supabaseAdmin
    .from("broadcast_campaigns")
    .select("id,creator_type,audience_type,recipient_count,original_message,final_message,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  ensureNoError(campaignsRes.error, "Failed to list broadcast campaigns");
  const campaigns = campaignsRes.data ?? [];

  if (campaigns.length === 0) {
    return [];
  }

  const campaignIds = campaigns.map((row) => row.id as string);
  const deliveryRes = await supabaseAdmin
    .from("broadcast_deliveries")
    .select("campaign_id,status,failure_reason")
    .in("campaign_id", campaignIds);

  ensureNoError(deliveryRes.error, "Failed to list broadcast deliveries");
  const deliveries = deliveryRes.data ?? [];
  const grouped = new Map<string, Array<{ status: string; failure_reason: string | null }>>();

  for (const row of deliveries as Array<{ campaign_id: string; status: string; failure_reason: string | null }>) {
    const list = grouped.get(row.campaign_id) ?? [];
    list.push({ status: row.status, failure_reason: row.failure_reason });
    grouped.set(row.campaign_id, list);
  }

  return campaigns.map((campaign) => {
    const rows = grouped.get(campaign.id as string) ?? [];
    const accepted = rows.filter((item) => item.status === "accepted").length;
    const sent = rows.filter((item) => item.status === "sent").length;
    const delivered = rows.filter((item) => item.status === "delivered").length;
    const read = rows.filter((item) => item.status === "read").length;
    const failed = rows.filter((item) => item.status === "failed").length;

    return {
      ...campaign,
      delivery_summary: {
        accepted,
        sent,
        delivered,
        read,
        failed,
      },
    };
  });
}

export async function getOpsDashboardMetrics(
  trackingDate: string,
  options?: { includeTestScheduler?: boolean },
) {
  const includeTestScheduler = options?.includeTestScheduler ?? true;
  const employees = await listEmployees();
  const activeEmployees = employees.filter((employee) => employee.is_active);
  const trackedActiveEmployees = activeEmployees.filter((employee) => employee.tracking_enabled);

  const todaySlotsRes = await supabaseAdmin
    .from("slot_responses")
    .select("is_missing,reply_count", { count: "exact" })
    .eq("tracking_date", trackingDate);
  ensureNoError(todaySlotsRes.error, "Failed to load slot metrics");

  const todayRows = todaySlotsRes.data ?? [];
  const missingSlots = todayRows.filter((row) => row.is_missing).length;
  const repliedSlots = todayRows.filter((row) => !row.is_missing).length;
  const totalReplyFragments = todayRows.reduce((sum, row) => sum + Number(row.reply_count ?? 0), 0);

  const reportsRes = await supabaseAdmin
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("report_date", trackingDate);
  ensureNoError(reportsRes.error, "Failed to load report metrics");

  let pendingTestJobs = 0;
  if (includeTestScheduler) {
    const runningSchedulesRes = await supabaseAdmin
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "test_scheduled_send")
      .eq("status", "running");
    ensureNoError(runningSchedulesRes.error, "Failed to load test schedule metrics");
    pendingTestJobs = runningSchedulesRes.count ?? 0;
  }

  const recentDeliveriesRes = await supabaseAdmin
    .from("broadcast_deliveries")
    .select("status", { count: "exact" })
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  ensureNoError(recentDeliveriesRes.error, "Failed to load delivery metrics");

  const recentDeliveries = recentDeliveriesRes.data ?? [];
  const delivered24h = recentDeliveries.filter((row) => row.status === "delivered" || row.status === "read").length;
  const failed24h = recentDeliveries.filter((row) => row.status === "failed").length;

  return {
    trackingDate,
    employees: {
      active: activeEmployees.length,
      trackedActive: trackedActiveEmployees.length,
      total: employees.length,
    },
    responses: {
      totalRows: todayRows.length,
      repliedSlots,
      missingSlots,
      totalReplyFragments,
      replyRate: todayRows.length > 0 ? Number(((repliedSlots / todayRows.length) * 100).toFixed(2)) : 0,
    },
    reports: {
      generatedToday: reportsRes.count ?? 0,
    },
    testScheduler: {
      pendingJobs: pendingTestJobs,
    },
    broadcast24h: {
      deliveries: recentDeliveriesRes.count ?? recentDeliveries.length,
      delivered: delivered24h,
      failed: failed24h,
    },
  };
}

export async function getSlotResponsesByDate(trackingDate: string) {
  const res = await supabaseAdmin
    .from("slot_responses")
    .select("id,employee_id,tracking_date,slot_key,merged_text,reply_count,is_missing,first_reply_at,last_reply_at,employees:employee_id(full_name)")
    .eq("tracking_date", trackingDate)
    .order("slot_key", { ascending: true });

  ensureNoError(res.error, "Failed to list slot responses");
  return res.data ?? [];
}

export async function getSlotResponsesInRange(startDate: string, endDate: string) {
  const res = await supabaseAdmin
    .from("slot_responses")
    .select(
      "id,employee_id,tracking_date,slot_key,merged_text,reply_count,is_missing,first_reply_at,last_reply_at,employees:employee_id(full_name)",
    )
    .gte("tracking_date", startDate)
    .lte("tracking_date", endDate)
    .order("tracking_date", { ascending: true });

  ensureNoError(res.error, "Failed to list slot responses by range");
  return res.data ?? [];
}

export async function purgeLegacyOperationalData() {
  const orderedTables = [
    "broadcast_delivery_events",
    "broadcast_deliveries",
    "broadcast_campaigns",
    "mention_resolution_audit",
    "reports",
    "slot_responses",
    "message_events",
    "job_runs",
  ];

  for (const table of orderedTables) {
    const res = await supabaseAdmin.from(table).delete().not("id", "is", null);
    ensureNoError(res.error, `Failed to purge table ${table}`);
  }

  return { clearedTables: orderedTables };
}
