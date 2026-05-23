import { addDays, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { env } from "@/lib/config";
import { summarizeReport } from "@/lib/ai";
import { logError } from "@/lib/logger";
import { WORKING_DAYS } from "@/lib/constants";
import { dhakaDayName } from "@/lib/time";
import {
  deleteReportsByDateAndKinds,
  getSlotResponsesByDate,
  getSlotResponsesInRange,
  getTrackedEmployees,
  insertReport,
  listActiveReportSlotPolicies,
  markMissingForSlot,
  type ReportSlotPolicy,
} from "@/lib/repository";
import type { ReportKind, ReportSlotKey } from "@/lib/types";

type SlotPolicy = {
  key: ReportSlotKey;
  label: string;
  mandatory: boolean;
  critical: boolean;
  weight: number;
  minuteOfDay: number;
};

type SlotResponseRow = {
  employee_id: string;
  tracking_date: string;
  slot_key: string;
  merged_text: string | null;
  reply_count: number | null;
  is_missing: boolean;
  first_reply_at?: string | null;
  last_reply_at?: string | null;
  employees?: { full_name?: string } | Array<{ full_name?: string }> | null;
};

type EmployeeDailyMetrics = {
  reportVersion: number;
  period: {
    type: "daily";
    startDate: string;
    endDate: string;
  };
  employee: {
    id: string;
    name: string;
  };
  summary: {
    mandatorySlotsExpected: number;
    mandatorySlotsReplied: number;
    mandatoryCompliancePct: number;
    criticalSlotsExpected: number;
    criticalSlotsReplied: number;
    criticalCompliancePct: number;
    weightedExpected: number;
    weightedEarned: number;
    weightedPerformancePct: number;
    totalReplyFragments: number;
    repliedSlots: number;
    missingSlots: number;
    morningReplyReceived: boolean;
  };
  slotBreakdown: Array<{
    slot: ReportSlotKey;
    label: string;
    mandatory: boolean;
    critical: boolean;
    weight: number;
    replied: boolean;
    replyCount: number;
    firstReplyAt: string | null;
    lastReplyAt: string | null;
    snippet: string | null;
  }>;
};

type EmployeePeriodMetrics = {
  employeeId: string;
  employeeName: string;
  periodDays: number;
  mandatorySlotsExpected: number;
  mandatorySlotsReplied: number;
  criticalSlotsExpected: number;
  criticalSlotsReplied: number;
  weightedExpected: number;
  weightedEarned: number;
  weightedPerformancePct: number;
  totalReplyFragments: number;
  slotMatrix: Record<ReportSlotKey, { expected: number; replied: number; missing: number }>;
};

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const groupKey = key(item);
    acc[groupKey] = acc[groupKey] ?? [];
    acc[groupKey].push(item);
    return acc;
  }, {});
}

function toPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function normalizeSlotKey(raw: unknown): ReportSlotKey | null {
  const text = String(raw ?? "").trim().toLowerCase();
  return text || null;
}

function humanizeSlotKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function fallbackPolicyForKey(key: ReportSlotKey): SlotPolicy {
  if (key === "morning") {
    return { key, label: "Morning", mandatory: false, critical: false, weight: 0, minuteOfDay: 8 * 60 };
  }
  if (key === "noon") {
    return { key, label: "Noon", mandatory: true, critical: false, weight: 1, minuteOfDay: 12 * 60 };
  }
  if (key === "afternoon") {
    return { key, label: "Afternoon", mandatory: true, critical: true, weight: 2.5, minuteOfDay: 15 * 60 };
  }
  if (key === "evening") {
    return { key, label: "Evening", mandatory: true, critical: true, weight: 3, minuteOfDay: 17 * 60 + 30 };
  }
  return {
    key,
    label: humanizeSlotKey(key),
    mandatory: true,
    critical: false,
    weight: 1,
    minuteOfDay: 24 * 60,
  };
}

function normalizePolicy(input: ReportSlotPolicy): SlotPolicy {
  const key = normalizeSlotKey(input.slotKey);
  if (!key) {
    throw new Error("Invalid report slot policy key");
  }

  const fallback = fallbackPolicyForKey(key);
  const normalizedWeight = Number(input.weight);
  return {
    key,
    label: String(input.label || fallback.label).trim() || fallback.label,
    mandatory: Boolean(input.mandatory),
    critical: Boolean(input.critical),
    weight: Number.isFinite(normalizedWeight)
      ? Number(Math.max(0, normalizedWeight).toFixed(2))
      : fallback.weight,
    minuteOfDay: Number.isFinite(input.minuteOfDay)
      ? Math.max(0, Math.min(1439, Math.floor(input.minuteOfDay)))
      : fallback.minuteOfDay,
  };
}

function normalizePolicies(inputs: ReportSlotPolicy[]): SlotPolicy[] {
  const unique = new Map<string, SlotPolicy>();

  for (const item of inputs) {
    try {
      const normalized = normalizePolicy(item);
      if (!unique.has(normalized.key)) {
        unique.set(normalized.key, normalized);
      }
    } catch {
      continue;
    }
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.minuteOfDay !== b.minuteOfDay) return a.minuteOfDay - b.minuteOfDay;
    return a.label.localeCompare(b.label);
  });
}

function withObservedPolicies(basePolicies: SlotPolicy[], rows: SlotResponseRow[]): SlotPolicy[] {
  const unique = new Map<string, SlotPolicy>(basePolicies.map((policy) => [policy.key, policy]));

  for (const row of rows) {
    const key = normalizeSlotKey(row.slot_key);
    if (!key || unique.has(key)) continue;
    unique.set(key, fallbackPolicyForKey(key));
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.minuteOfDay !== b.minuteOfDay) return a.minuteOfDay - b.minuteOfDay;
    return a.label.localeCompare(b.label);
  });
}

function buildPolicyMap(slotPolicies: SlotPolicy[]): Map<ReportSlotKey, SlotPolicy> {
  return new Map(slotPolicies.map((policy) => [policy.key, policy]));
}

function resolveEmployeeName(row: SlotResponseRow | undefined): string {
  if (!row?.employees) return "Unknown";
  if (Array.isArray(row.employees)) return row.employees[0]?.full_name ?? "Unknown";
  return row.employees.full_name ?? "Unknown";
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const dates: string[] = [];
  let cursor = start;

  while (cursor <= end) {
    dates.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function isWorkingTrackingDate(date: string): boolean {
  const probe = new Date(`${date}T12:00:00.000Z`);
  const dayName = dhakaDayName(probe, env.NEXT_PUBLIC_APP_TIMEZONE);
  return WORKING_DAYS.includes(dayName);
}

async function ensureSlotCoverageForDates(dates: string[], slotPolicies: SlotPolicy[]): Promise<string[]> {
  const trackedEmployees = await getTrackedEmployees();
  const employeeIds = trackedEmployees.map((employee) => employee.id);

  if (employeeIds.length === 0 || dates.length === 0 || slotPolicies.length === 0) {
    return employeeIds;
  }

  for (const trackingDate of dates) {
    for (const policy of slotPolicies) {
      await markMissingForSlot({
        trackingDate,
        slotKey: policy.key,
        employeeIds,
      });
    }
  }

  return employeeIds;
}

function buildPolicyInstruction(slotPolicies: SlotPolicy[]): string {
  const mandatory = slotPolicies.filter((item) => item.mandatory);
  const critical = slotPolicies.filter((item) => item.critical);
  const optional = slotPolicies.filter((item) => !item.mandatory);

  const mandatoryText = mandatory.length
    ? `Mandatory slots: ${mandatory.map((item) => item.label).join(", ")}.`
    : "No mandatory slots are configured.";
  const criticalText = critical.length
    ? `Critical slots: ${critical.map((item) => item.label).join(", ")}.`
    : "No slots are marked critical.";
  const optionalText = optional.length
    ? `Optional slots: ${optional.map((item) => item.label).join(", ")}.`
    : "No optional slots are configured.";

  return `${mandatoryText} ${criticalText} ${optionalText} Use configured slot weights for weighted performance scoring.`;
}

function buildDailyEmployeeMetrics(
  employeeId: string,
  employeeName: string,
  rows: SlotResponseRow[],
  reportDate: string,
  slotPolicies: SlotPolicy[],
): EmployeeDailyMetrics {
  const bySlot = new Map<ReportSlotKey, SlotResponseRow>();
  for (const row of rows) {
    const slot = normalizeSlotKey(row.slot_key);
    if (!slot) continue;
    bySlot.set(slot, row);
  }

  const slotBreakdown = slotPolicies.map((policy) => {
    const row = bySlot.get(policy.key);
    const replyCount = Number(row?.reply_count ?? 0);
    const replied = row ? !row.is_missing : false;
    const snippet = row?.merged_text?.trim() ? row.merged_text.trim().slice(0, 220) : null;

    return {
      slot: policy.key,
      label: policy.label,
      mandatory: policy.mandatory,
      critical: policy.critical,
      weight: policy.weight,
      replied,
      replyCount,
      firstReplyAt: row?.first_reply_at ?? null,
      lastReplyAt: row?.last_reply_at ?? null,
      snippet,
    };
  });

  const mandatorySlotsExpected = slotBreakdown.filter((slot) => slot.mandatory).length;
  const criticalSlotsExpected = slotBreakdown.filter((slot) => slot.critical).length;

  const mandatorySlotsReplied = slotBreakdown.filter((slot) => slot.mandatory && slot.replied).length;
  const criticalSlotsReplied = slotBreakdown.filter((slot) => slot.critical && slot.replied).length;

  const weightedExpected = Number(
    slotBreakdown
      .filter((slot) => slot.mandatory)
      .reduce((sum, slot) => sum + slot.weight, 0)
      .toFixed(2),
  );

  const weightedEarned = Number(
    slotBreakdown
      .filter((slot) => slot.mandatory && slot.replied)
      .reduce((sum, slot) => sum + slot.weight, 0)
      .toFixed(2),
  );

  const totalReplyFragments = slotBreakdown.reduce((sum, slot) => sum + slot.replyCount, 0);
  const repliedSlots = slotBreakdown.filter((slot) => slot.replied).length;
  const missingSlots = slotBreakdown.length - repliedSlots;

  return {
    reportVersion: 3,
    period: {
      type: "daily",
      startDate: reportDate,
      endDate: reportDate,
    },
    employee: {
      id: employeeId,
      name: employeeName,
    },
    summary: {
      mandatorySlotsExpected,
      mandatorySlotsReplied,
      mandatoryCompliancePct: toPct(mandatorySlotsReplied, mandatorySlotsExpected),
      criticalSlotsExpected,
      criticalSlotsReplied,
      criticalCompliancePct: toPct(criticalSlotsReplied, criticalSlotsExpected),
      weightedExpected,
      weightedEarned,
      weightedPerformancePct: toPct(weightedEarned, weightedExpected),
      totalReplyFragments,
      repliedSlots,
      missingSlots,
      morningReplyReceived: Boolean(slotBreakdown.find((slot) => slot.slot === "morning")?.replied),
    },
    slotBreakdown,
  };
}

function buildPeriodEmployeeMetrics(
  employeeId: string,
  employeeName: string,
  rows: SlotResponseRow[],
  periodDays: number,
  slotPolicies: SlotPolicy[],
): EmployeePeriodMetrics {
  const policyMap = buildPolicyMap(slotPolicies);
  const slotMatrix: Record<ReportSlotKey, { expected: number; replied: number; missing: number }> = {};

  for (const policy of slotPolicies) {
    slotMatrix[policy.key] = { expected: periodDays, replied: 0, missing: 0 };
  }

  let totalReplyFragments = 0;
  let weightedEarned = 0;

  for (const row of rows) {
    const slot = normalizeSlotKey(row.slot_key);
    if (!slot) continue;

    if (!slotMatrix[slot]) {
      slotMatrix[slot] = { expected: periodDays, replied: 0, missing: 0 };
    }

    if (!policyMap.has(slot)) {
      policyMap.set(slot, fallbackPolicyForKey(slot));
    }

    const policy = policyMap.get(slot);
    const replyCount = Number(row.reply_count ?? 0);
    totalReplyFragments += replyCount;

    if (!row.is_missing) {
      slotMatrix[slot].replied += 1;
      if (policy?.mandatory) {
        weightedEarned += policy.weight;
      }
    } else {
      slotMatrix[slot].missing += 1;
    }
  }

  for (const key of Object.keys(slotMatrix)) {
    const slotKey = key as ReportSlotKey;
    const accounted = slotMatrix[slotKey].replied + slotMatrix[slotKey].missing;
    if (accounted < periodDays) {
      slotMatrix[slotKey].missing += periodDays - accounted;
    }
  }

  const policies = Array.from(policyMap.values());
  const mandatoryPolicies = policies.filter((policy) => policy.mandatory);
  const criticalPolicies = policies.filter((policy) => policy.critical);

  const mandatorySlotsExpected = periodDays * mandatoryPolicies.length;
  const mandatorySlotsReplied = mandatoryPolicies.reduce(
    (sum, policy) => sum + (slotMatrix[policy.key]?.replied ?? 0),
    0,
  );

  const criticalSlotsExpected = periodDays * criticalPolicies.length;
  const criticalSlotsReplied = criticalPolicies.reduce((sum, policy) => sum + (slotMatrix[policy.key]?.replied ?? 0), 0);

  const mandatoryWeightTotal = mandatoryPolicies.reduce((sum, policy) => sum + policy.weight, 0);
  const weightedExpected = Number((periodDays * mandatoryWeightTotal).toFixed(2));

  return {
    employeeId,
    employeeName,
    periodDays,
    mandatorySlotsExpected,
    mandatorySlotsReplied,
    criticalSlotsExpected,
    criticalSlotsReplied,
    weightedExpected,
    weightedEarned: Number(weightedEarned.toFixed(2)),
    weightedPerformancePct: toPct(weightedEarned, weightedExpected),
    totalReplyFragments,
    slotMatrix,
  };
}

function buildTeamDailyMetrics(
  reportDate: string,
  employees: EmployeeDailyMetrics[],
  totalRows: number,
  slotPolicies: SlotPolicy[],
): Record<string, unknown> {
  const membersTracked = employees.length;

  const mandatorySlots = slotPolicies.filter((policy) => policy.mandatory).map((policy) => policy.key);
  const criticalSlots = slotPolicies.filter((policy) => policy.critical).map((policy) => policy.key);

  const slotSummary = slotPolicies.map((policy) => {
    const replied = employees.filter((item) => item.slotBreakdown.find((detail) => detail.slot === policy.key)?.replied).length;
    const expected = membersTracked;
    return {
      slot: policy.key,
      label: policy.label,
      critical: policy.critical,
      mandatory: policy.mandatory,
      weight: policy.weight,
      expected,
      replied,
      missing: Math.max(expected - replied, 0),
      compliancePct: toPct(replied, expected),
    };
  });

  const averageWeighted = membersTracked
    ? Number(
        (employees.reduce((sum, item) => sum + item.summary.weightedPerformancePct, 0) / membersTracked).toFixed(2),
      )
    : 0;

  const criticalPerfectCount = employees.filter(
    (item) => item.summary.criticalSlotsReplied === item.summary.criticalSlotsExpected,
  ).length;

  const atRiskMembers = employees
    .filter((item) => item.summary.criticalSlotsReplied < item.summary.criticalSlotsExpected)
    .sort((a, b) => a.summary.weightedPerformancePct - b.summary.weightedPerformancePct)
    .slice(0, 12)
    .map((item) => ({
      employeeId: item.employee.id,
      employeeName: item.employee.name,
      criticalSlotsReplied: item.summary.criticalSlotsReplied,
      criticalSlotsExpected: item.summary.criticalSlotsExpected,
      weightedPerformancePct: item.summary.weightedPerformancePct,
    }));

  return {
    reportVersion: 3,
    period: {
      type: "daily",
      startDate: reportDate,
      endDate: reportDate,
    },
    policy: {
      mandatorySlots,
      criticalSlots,
      optionalSlots: slotPolicies.filter((policy) => !policy.mandatory).map((policy) => policy.key),
      slotWeights: Object.fromEntries(slotPolicies.map((policy) => [policy.key, policy.weight])),
    },
    kpi: {
      membersTracked,
      slotRowsCaptured: totalRows,
      criticalPerfectCount,
      criticalCompliancePct: toPct(criticalPerfectCount, membersTracked),
      averageWeightedPerformancePct: averageWeighted,
      totalReplyFragments: employees.reduce((sum, item) => sum + item.summary.totalReplyFragments, 0),
      morningParticipationPct: toPct(
        employees.filter((item) => item.summary.morningReplyReceived).length,
        membersTracked,
      ),
    },
    slotSummary,
    atRiskMembers,
  };
}

function buildTeamPeriodMetrics(input: {
  kind: "team_weekly" | "team_monthly";
  startDate: string;
  endDate: string;
  periodDays: number;
  members: EmployeePeriodMetrics[];
  totalRows: number;
  slotPolicies: SlotPolicy[];
}): Record<string, unknown> {
  const membersTracked = input.members.length;

  const slotSummary = input.slotPolicies.map((policy) => {
    const expected = membersTracked * input.periodDays;
    const replied = input.members.reduce((sum, member) => sum + (member.slotMatrix[policy.key]?.replied ?? 0), 0);
    return {
      slot: policy.key,
      label: policy.label,
      critical: policy.critical,
      mandatory: policy.mandatory,
      weight: policy.weight,
      expected,
      replied,
      missing: Math.max(expected - replied, 0),
      compliancePct: toPct(replied, expected),
    };
  });

  const averageWeighted = membersTracked
    ? Number(
        (input.members.reduce((sum, member) => sum + member.weightedPerformancePct, 0) / membersTracked).toFixed(2),
      )
    : 0;

  const criticalSlotCount = input.slotPolicies.filter((policy) => policy.critical).length;
  const criticalExpectedPerMember = input.periodDays * criticalSlotCount;

  const criticalPerfectCount = input.members.filter(
    (member) => member.criticalSlotsReplied === criticalExpectedPerMember,
  ).length;

  const atRiskMembers = input.members
    .filter((member) => member.criticalSlotsReplied < criticalExpectedPerMember)
    .sort((a, b) => a.weightedPerformancePct - b.weightedPerformancePct)
    .slice(0, 15)
    .map((member) => ({
      employeeId: member.employeeId,
      employeeName: member.employeeName,
      criticalSlotsReplied: member.criticalSlotsReplied,
      criticalSlotsExpected: member.criticalSlotsExpected,
      weightedPerformancePct: member.weightedPerformancePct,
    }));

  const topPerformers = [...input.members]
    .sort((a, b) => b.weightedPerformancePct - a.weightedPerformancePct)
    .slice(0, 8)
    .map((member) => ({
      employeeId: member.employeeId,
      employeeName: member.employeeName,
      weightedPerformancePct: member.weightedPerformancePct,
      criticalSlotsReplied: member.criticalSlotsReplied,
      criticalSlotsExpected: member.criticalSlotsExpected,
    }));

  return {
    reportVersion: 3,
    period: {
      type: input.kind === "team_weekly" ? "weekly" : "monthly",
      startDate: input.startDate,
      endDate: input.endDate,
      days: input.periodDays,
    },
    policy: {
      mandatorySlots: input.slotPolicies.filter((policy) => policy.mandatory).map((policy) => policy.key),
      criticalSlots: input.slotPolicies.filter((policy) => policy.critical).map((policy) => policy.key),
      optionalSlots: input.slotPolicies.filter((policy) => !policy.mandatory).map((policy) => policy.key),
      slotWeights: Object.fromEntries(input.slotPolicies.map((policy) => [policy.key, policy.weight])),
    },
    kpi: {
      membersTracked,
      slotRowsCaptured: input.totalRows,
      totalReplyFragments: input.members.reduce((sum, member) => sum + member.totalReplyFragments, 0),
      averageWeightedPerformancePct: averageWeighted,
      criticalPerfectCount,
      criticalPerfectPct: toPct(criticalPerfectCount, membersTracked),
    },
    slotSummary,
    topPerformers,
    atRiskMembers,
  };
}

function fallbackIndividualNarrative(metrics: EmployeeDailyMetrics, policyInstruction: string): string {
  return [
    `${metrics.employee.name} daily summary.`,
    `Critical compliance: ${metrics.summary.criticalSlotsReplied}/${metrics.summary.criticalSlotsExpected} (${metrics.summary.criticalCompliancePct}%).`,
    `Mandatory compliance: ${metrics.summary.mandatorySlotsReplied}/${metrics.summary.mandatorySlotsExpected} (${metrics.summary.mandatoryCompliancePct}%).`,
    `Weighted performance: ${metrics.summary.weightedPerformancePct}%.`,
    policyInstruction,
  ].join(" ");
}

function fallbackTeamNarrative(reportDate: string, metrics: Record<string, unknown>, policyInstruction: string): string {
  const kpi = (metrics.kpi ?? {}) as Record<string, unknown>;
  return [
    `Team daily summary for ${reportDate}.`,
    `Tracked members: ${Number(kpi.membersTracked ?? 0)}.`,
    `Critical-perfect members: ${Number(kpi.criticalPerfectCount ?? 0)} (${Number(kpi.criticalCompliancePct ?? 0)}%).`,
    `Average weighted performance: ${Number(kpi.averageWeightedPerformancePct ?? 0)}%.`,
    policyInstruction,
  ].join(" ");
}

function fallbackPeriodNarrative(
  title: string,
  metrics: Record<string, unknown>,
  policyInstruction: string,
): string {
  const kpi = (metrics.kpi ?? {}) as Record<string, unknown>;
  return [
    `${title}.`,
    `Tracked members: ${Number(kpi.membersTracked ?? 0)}.`,
    `Average weighted performance: ${Number(kpi.averageWeightedPerformancePct ?? 0)}%.`,
    `Critical-perfect share: ${Number(kpi.criticalPerfectPct ?? 0)}%.`,
    policyInstruction,
  ].join(" ");
}

async function loadNormalizedSlotPolicies(): Promise<SlotPolicy[]> {
  const raw = await listActiveReportSlotPolicies();
  return normalizePolicies(raw);
}

async function buildTeamRangeReport(input: {
  kind: "team_weekly" | "team_monthly";
  startDate: string;
  endDate: string;
  title: string;
  aiInstruction: string;
}) {
  const dates = enumerateDates(input.startDate, input.endDate).filter(isWorkingTrackingDate);
  const activePolicies = await loadNormalizedSlotPolicies();
  await ensureSlotCoverageForDates(dates, activePolicies);

  const workingDateSet = new Set(dates);
  const rows = ((await getSlotResponsesInRange(input.startDate, input.endDate)) as SlotResponseRow[])
    .filter((row) => workingDateSet.has(String(row.tracking_date)));

  const effectivePolicies = withObservedPolicies(activePolicies, rows);
  const byEmployee = groupBy(rows, (row) => row.employee_id);
  const periodDays = dates.length;

  const memberMetrics = Object.entries(byEmployee).map(([employeeId, employeeRows]) =>
    buildPeriodEmployeeMetrics(employeeId, resolveEmployeeName(employeeRows[0]), employeeRows, periodDays, effectivePolicies),
  );

  const teamMetrics = buildTeamPeriodMetrics({
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
    periodDays,
    members: memberMetrics,
    totalRows: rows.length,
    slotPolicies: effectivePolicies,
  });

  const policyInstruction = buildPolicyInstruction(effectivePolicies);
  let narrative = fallbackPeriodNarrative(input.title, teamMetrics, policyInstruction);

  try {
    narrative = await summarizeReport(
      input.title,
      teamMetrics,
      `${input.aiInstruction} ${policyInstruction}`,
    );
  } catch (error) {
    logError(`${input.kind} AI summary failed`, {
      startDate: input.startDate,
      endDate: input.endDate,
      error: (error as Error).message,
    });
  }

  await deleteReportsByDateAndKinds(input.endDate, [input.kind as ReportKind]);

  await insertReport({
    kind: input.kind,
    reportDate: input.endDate,
    title: input.title,
    metrics: teamMetrics,
    narrative,
    modelName: env.GEMINI_MODEL,
  });

  return teamMetrics;
}

export async function generateDailyReports(reportDate: string) {
  const activePolicies = await loadNormalizedSlotPolicies();
  await ensureSlotCoverageForDates([reportDate], activePolicies);

  const responses = (await getSlotResponsesByDate(reportDate)) as SlotResponseRow[];
  const effectivePolicies = withObservedPolicies(activePolicies, responses);
  const policyInstruction = buildPolicyInstruction(effectivePolicies);
  const byEmployee = groupBy(responses, (item) => item.employee_id as string);

  await deleteReportsByDateAndKinds(reportDate, ["individual_daily", "team_daily"]);

  let individualCreated = 0;
  let individualFailed = 0;
  const failures: Array<{ employeeId?: string; employeeName?: string; reason: string }> = [];
  const individualMetricsList: EmployeeDailyMetrics[] = [];

  for (const [employeeId, rows] of Object.entries(byEmployee)) {
    const employeeName = resolveEmployeeName(rows[0]);
    const metrics = buildDailyEmployeeMetrics(employeeId, employeeName, rows, reportDate, effectivePolicies);
    individualMetricsList.push(metrics);

    let narrative = fallbackIndividualNarrative(metrics, policyInstruction);

    try {
      narrative = await summarizeReport(
        `Daily individual report for ${employeeName} (${reportDate})`,
        metrics,
        `Write in English. Keep this concise and operational. ${policyInstruction}`,
      );
    } catch (error) {
      failures.push({
        employeeId,
        employeeName,
        reason: `AI summary failed: ${(error as Error).message}`,
      });
      logError("Individual report AI summary failed", {
        employeeId,
        employeeName,
        reportDate,
        error: (error as Error).message,
      });
    }

    try {
      await insertReport({
        kind: "individual_daily",
        reportDate,
        employeeId,
        title: `Daily compliance report - ${employeeName}`,
        metrics,
        narrative,
        modelName: env.GEMINI_MODEL,
      });
      individualCreated += 1;
    } catch (error) {
      individualFailed += 1;
      failures.push({
        employeeId,
        employeeName,
        reason: `Insert failed: ${(error as Error).message}`,
      });
      logError("Individual report insert failed", {
        employeeId,
        employeeName,
        reportDate,
        error: (error as Error).message,
      });
    }
  }

  const teamMetrics = buildTeamDailyMetrics(reportDate, individualMetricsList, responses.length, effectivePolicies);
  let teamNarrative = fallbackTeamNarrative(reportDate, teamMetrics, policyInstruction);

  try {
    teamNarrative = await summarizeReport(
      `Team daily report for ${reportDate}`,
      teamMetrics,
      `Write in English for CEO-level review. Highlight compliance risks and operational actions. ${policyInstruction}`,
    );
  } catch (error) {
    failures.push({ reason: `Team AI summary failed: ${(error as Error).message}` });
    logError("Team daily AI summary failed", {
      reportDate,
      error: (error as Error).message,
    });
  }

  try {
    await insertReport({
      kind: "team_daily",
      reportDate,
      title: `Team daily executive summary - ${reportDate}`,
      metrics: teamMetrics,
      narrative: teamNarrative,
      modelName: env.GEMINI_MODEL,
    });
  } catch (error) {
    failures.push({ reason: `Team report insert failed: ${(error as Error).message}` });
    logError("Team daily report insert failed", {
      reportDate,
      error: (error as Error).message,
    });
  }

  return {
    reportDate,
    totalMembers: Object.keys(byEmployee).length,
    responses: responses.length,
    individualCreated,
    individualFailed,
    failures,
  };
}

export function weeklyRangeForDhakaDate(date: Date): { start: string; end: string } {
  const zoned = toZonedTime(date, env.NEXT_PUBLIC_APP_TIMEZONE);
  const weekStart = startOfWeek(zoned, { weekStartsOn: 6 });
  const weekEnd = addDays(weekStart, 5);

  return {
    start: format(weekStart, "yyyy-MM-dd"),
    end: format(weekEnd, "yyyy-MM-dd"),
  };
}

export function monthlyRangeForDhakaDate(date: Date): { start: string; end: string } {
  const zoned = toZonedTime(date, env.NEXT_PUBLIC_APP_TIMEZONE);
  return {
    start: format(startOfMonth(zoned), "yyyy-MM-dd"),
    end: format(endOfMonth(zoned), "yyyy-MM-dd"),
  };
}

export async function generateWeeklyReport(anchorDate: Date) {
  const range = weeklyRangeForDhakaDate(anchorDate);
  return buildTeamRangeReport({
    kind: "team_weekly",
    startDate: range.start,
    endDate: range.end,
    title: `Team weekly executive summary - ${range.start} to ${range.end}`,
    aiInstruction:
      "Write in English as an executive weekly summary. Include concrete risks and next-week actions.",
  });
}

export async function generateMonthlyReport(anchorDate: Date) {
  const range = monthlyRangeForDhakaDate(anchorDate);
  return buildTeamRangeReport({
    kind: "team_monthly",
    startDate: range.start,
    endDate: range.end,
    title: `Team monthly executive summary - ${range.start} to ${range.end}`,
    aiInstruction:
      "Write in English as a monthly executive review. Prioritize compliance trend, structural risks, and corrective actions for next month.",
  });
}
