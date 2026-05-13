import { normalizeBangladeshPhone } from "@/lib/phone";
import { supabaseAdmin } from "@/lib/db";
import { TRACKING_TAG_KEY } from "@/lib/constants";
import type { BroadcastDeliveryLifecycleStatus, ReportKind, SlotKey } from "@/lib/types";

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

const MODERN_EMPLOYEE_SELECT =
  "id,full_name,designation,department,branch,whatsapp_number_raw,whatsapp_e164,tracking_enabled,is_active,status,aliases,notes";
const LEGACY_EMPLOYEE_SELECT =
  "id,full_name,designation,department,branch,whatsapp_number,is_active_for_tracking,status,created_at,updated_at";

let cachedEmployeeSchema: EmployeesSchemaMode | null = null;
let cachedTagSupport: boolean | null = null;

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

export async function getTemplateBySlot(slotKey: SlotKey): Promise<{
  slot_key: SlotKey;
  template_name: string;
  language_code: string;
} | null> {
  const res = await supabaseAdmin
    .from("message_templates")
    .select("slot_key,template_name,language_code")
    .eq("slot_key", slotKey)
    .eq("is_active", true)
    .maybeSingle();

  ensureNoError(res.error, "Failed to fetch slot template");
  return (res.data as { slot_key: SlotKey; template_name: string; language_code: string } | null) ?? null;
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
  const res = await supabaseAdmin.from("broadcast_deliveries").insert({
    campaign_id: input.campaignId,
    employee_id: input.employeeId,
    whatsapp_message_id: input.whatsappMessageId ?? null,
    status: input.status,
    failure_reason: input.failureReason ?? null,
    last_status_at: input.lastStatusAt ?? new Date().toISOString(),
    status_payload: input.statusPayload ?? {},
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
    const updateRes = await supabaseAdmin
      .from("broadcast_deliveries")
      .update({
        status: input.status,
        failure_reason: input.failureReason ?? null,
        last_status_at: input.occurredAt ?? new Date().toISOString(),
        status_payload: input.payload ?? {},
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

export async function getOpsDashboardMetrics(trackingDate: string) {
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

  const runningSchedulesRes = await supabaseAdmin
    .from("job_runs")
    .select("id", { count: "exact", head: true })
    .eq("job_type", "test_scheduled_send")
    .eq("status", "running");
  ensureNoError(runningSchedulesRes.error, "Failed to load test schedule metrics");

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
      pendingJobs: runningSchedulesRes.count ?? 0,
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
    .select("id,employee_id,tracking_date,slot_key,merged_text,reply_count,is_missing,employees:employee_id(full_name)")
    .gte("tracking_date", startDate)
    .lte("tracking_date", endDate)
    .order("tracking_date", { ascending: true });

  ensureNoError(res.error, "Failed to list slot responses by range");
  return res.data ?? [];
}
