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
  markMissingForSlot,
} from "@/lib/repository";
import type { ReportKind, SlotKey } from "@/lib/types";

const SLOT_KEYS: SlotKey[] = ["morning", "noon", "afternoon", "evening"];

const SLOT_PRIORITY: Record<
  SlotKey,
  { label: string; mandatory: boolean; critical: boolean; weight: number }
> = {
  morning: { label: "Morning", mandatory: false, critical: false, weight: 0 },
  noon: { label: "Noon", mandatory: true, critical: false, weight: 1 },
  afternoon: { label: "Afternoon", mandatory: true, critical: true, weight: 2.5 },
  evening: { label: "Evening", mandatory: true, critical: true, weight: 3 },
};

const MANDATORY_SLOT_KEYS = SLOT_KEYS.filter((slot) => SLOT_PRIORITY[slot].mandatory);
const CRITICAL_SLOT_KEYS = SLOT_KEYS.filter((slot) => SLOT_PRIORITY[slot].critical);
const MANDATORY_WEIGHT_TOTAL = MANDATORY_SLOT_KEYS.reduce((sum, slot) => sum + SLOT_PRIORITY[slot].weight, 0);

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
    slot: SlotKey;
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
  slotMatrix: Record<SlotKey, { expected: number; replied: number; missing: number }>;
};

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const groupKey = key(item);
    acc[groupKey] = acc[groupKey] ?? [];
    acc[groupKey].push(item);
    return acc;
  }, {});
}

function normalizeSlotKey(raw: string): SlotKey | null {
  if (raw === "morning" || raw === "noon" || raw === "afternoon" || raw === "evening") {
    return raw;
  }
  return null;
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

async function ensureSlotCoverageForDates(dates: string[]): Promise<string[]> {
  const trackedEmployees = await getTrackedEmployees();
  const employeeIds = trackedEmployees.map((employee) => employee.id);

  if (employeeIds.length === 0 || dates.length === 0) {
    return employeeIds;
  }

  for (const trackingDate of dates) {
    for (const slotKey of SLOT_KEYS) {
      await markMissingForSlot({
        trackingDate,
        slotKey,
        employeeIds,
      });
    }
  }

  return employeeIds;
}

function toPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function buildDailyEmployeeMetrics(
  employeeId: string,
  employeeName: string,
  rows: SlotResponseRow[],
  reportDate: string,
): EmployeeDailyMetrics {
  const bySlot = new Map<SlotKey, SlotResponseRow>();
  for (const row of rows) {
    const slot = normalizeSlotKey(row.slot_key);
    if (!slot) continue;
    bySlot.set(slot, row);
  }

  const slotBreakdown = SLOT_KEYS.map((slot) => {
    const row = bySlot.get(slot);
    const replyCount = Number(row?.reply_count ?? 0);
    const replied = row ? !row.is_missing : false;
    const snippet = row?.merged_text?.trim() ? row.merged_text.trim().slice(0, 220) : null;

    return {
      slot,
      label: SLOT_PRIORITY[slot].label,
      mandatory: SLOT_PRIORITY[slot].mandatory,
      critical: SLOT_PRIORITY[slot].critical,
      weight: SLOT_PRIORITY[slot].weight,
      replied,
      replyCount,
      firstReplyAt: row?.first_reply_at ?? null,
      lastReplyAt: row?.last_reply_at ?? null,
      snippet,
    };
  });

  const mandatorySlotsReplied = slotBreakdown.filter((slot) => slot.mandatory && slot.replied).length;
  const criticalSlotsReplied = slotBreakdown.filter((slot) => slot.critical && slot.replied).length;
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
    reportVersion: 2,
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
      mandatorySlotsExpected: MANDATORY_SLOT_KEYS.length,
      mandatorySlotsReplied,
      mandatoryCompliancePct: toPct(mandatorySlotsReplied, MANDATORY_SLOT_KEYS.length),
      criticalSlotsExpected: CRITICAL_SLOT_KEYS.length,
      criticalSlotsReplied,
      criticalCompliancePct: toPct(criticalSlotsReplied, CRITICAL_SLOT_KEYS.length),
      weightedExpected: MANDATORY_WEIGHT_TOTAL,
      weightedEarned,
      weightedPerformancePct: toPct(weightedEarned, MANDATORY_WEIGHT_TOTAL),
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
): EmployeePeriodMetrics {
  const slotMatrix: Record<SlotKey, { expected: number; replied: number; missing: number }> = {
    morning: { expected: periodDays, replied: 0, missing: 0 },
    noon: { expected: periodDays, replied: 0, missing: 0 },
    afternoon: { expected: periodDays, replied: 0, missing: 0 },
    evening: { expected: periodDays, replied: 0, missing: 0 },
  };

  let totalReplyFragments = 0;
  let weightedEarned = 0;

  for (const row of rows) {
    const slot = normalizeSlotKey(row.slot_key);
    if (!slot) continue;

    const replyCount = Number(row.reply_count ?? 0);
    totalReplyFragments += replyCount;

    if (!row.is_missing) {
      slotMatrix[slot].replied += 1;
      if (SLOT_PRIORITY[slot].mandatory) {
        weightedEarned += SLOT_PRIORITY[slot].weight;
      }
    } else {
      slotMatrix[slot].missing += 1;
    }
  }

  for (const slot of SLOT_KEYS) {
    const accounted = slotMatrix[slot].replied + slotMatrix[slot].missing;
    if (accounted < periodDays) {
      slotMatrix[slot].missing += periodDays - accounted;
    }
  }

  const mandatorySlotsExpected = periodDays * MANDATORY_SLOT_KEYS.length;
  const mandatorySlotsReplied = MANDATORY_SLOT_KEYS.reduce((sum, slot) => sum + slotMatrix[slot].replied, 0);
  const criticalSlotsExpected = periodDays * CRITICAL_SLOT_KEYS.length;
  const criticalSlotsReplied = CRITICAL_SLOT_KEYS.reduce((sum, slot) => sum + slotMatrix[slot].replied, 0);
  const weightedExpected = Number((periodDays * MANDATORY_WEIGHT_TOTAL).toFixed(2));

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
): Record<string, unknown> {
  const membersTracked = employees.length;

  const slotSummary = SLOT_KEYS.map((slot) => {
    const replied = employees.filter((item) => item.slotBreakdown.find((detail) => detail.slot === slot)?.replied).length;
    const expected = membersTracked;
    return {
      slot,
      label: SLOT_PRIORITY[slot].label,
      critical: SLOT_PRIORITY[slot].critical,
      mandatory: SLOT_PRIORITY[slot].mandatory,
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
      weightedPerformancePct: item.summary.weightedPerformancePct,
    }));

  return {
    reportVersion: 2,
    period: {
      type: "daily",
      startDate: reportDate,
      endDate: reportDate,
    },
    policy: {
      morningOptional: true,
      criticalSlots: CRITICAL_SLOT_KEYS,
      mandatorySlots: MANDATORY_SLOT_KEYS,
      slotWeights: SLOT_PRIORITY,
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
}): Record<string, unknown> {
  const membersTracked = input.members.length;

  const slotSummary = SLOT_KEYS.map((slot) => {
    const expected = membersTracked * input.periodDays;
    const replied = input.members.reduce((sum, item) => sum + item.slotMatrix[slot].replied, 0);
    return {
      slot,
      label: SLOT_PRIORITY[slot].label,
      critical: SLOT_PRIORITY[slot].critical,
      mandatory: SLOT_PRIORITY[slot].mandatory,
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

  const criticalExpectedPerMember = input.periodDays * CRITICAL_SLOT_KEYS.length;
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
    reportVersion: 2,
    period: {
      type: input.kind === "team_weekly" ? "weekly" : "monthly",
      startDate: input.startDate,
      endDate: input.endDate,
      days: input.periodDays,
    },
    policy: {
      morningOptional: true,
      criticalSlots: CRITICAL_SLOT_KEYS,
      mandatorySlots: MANDATORY_SLOT_KEYS,
      slotWeights: SLOT_PRIORITY,
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

function fallbackIndividualNarrative(metrics: EmployeeDailyMetrics): string {
  return [
    `${metrics.employee.name} daily summary: morning reply is optional, while afternoon and evening are critical.`,
    `Critical compliance: ${metrics.summary.criticalSlotsReplied}/${metrics.summary.criticalSlotsExpected} (${metrics.summary.criticalCompliancePct}%).`,
    `Mandatory compliance: ${metrics.summary.mandatorySlotsReplied}/${metrics.summary.mandatorySlotsExpected} (${metrics.summary.mandatoryCompliancePct}%).`,
    `Weighted performance: ${metrics.summary.weightedPerformancePct}%.`,
  ].join(" ");
}

function fallbackTeamNarrative(reportDate: string, metrics: Record<string, unknown>): string {
  const kpi = (metrics.kpi ?? {}) as Record<string, unknown>;
  return [
    `Team daily summary for ${reportDate}.`,
    `Tracked members: ${Number(kpi.membersTracked ?? 0)}.`,
    `Critical-perfect members: ${Number(kpi.criticalPerfectCount ?? 0)} (${Number(kpi.criticalCompliancePct ?? 0)}%).`,
    `Average weighted performance: ${Number(kpi.averageWeightedPerformancePct ?? 0)}%.`,
  ].join(" ");
}

function fallbackPeriodNarrative(
  title: string,
  metrics: Record<string, unknown>,
): string {
  const kpi = (metrics.kpi ?? {}) as Record<string, unknown>;
  return [
    `${title}.`,
    `Tracked members: ${Number(kpi.membersTracked ?? 0)}.`,
    `Average weighted performance: ${Number(kpi.averageWeightedPerformancePct ?? 0)}%.`,
    `Critical-perfect share: ${Number(kpi.criticalPerfectPct ?? 0)}%.`,
  ].join(" ");
}

async function buildTeamRangeReport(input: {
  kind: "team_weekly" | "team_monthly";
  startDate: string;
  endDate: string;
  title: string;
  aiInstruction: string;
}) {
  const dates = enumerateDates(input.startDate, input.endDate).filter(isWorkingTrackingDate);
  await ensureSlotCoverageForDates(dates);

  const workingDateSet = new Set(dates);
  const rows = ((await getSlotResponsesInRange(input.startDate, input.endDate)) as SlotResponseRow[])
    .filter((row) => workingDateSet.has(String(row.tracking_date)));
  const byEmployee = groupBy(rows, (row) => row.employee_id);
  const periodDays = dates.length;

  const memberMetrics = Object.entries(byEmployee).map(([employeeId, employeeRows]) =>
    buildPeriodEmployeeMetrics(employeeId, resolveEmployeeName(employeeRows[0]), employeeRows, periodDays),
  );

  const teamMetrics = buildTeamPeriodMetrics({
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
    periodDays,
    members: memberMetrics,
    totalRows: rows.length,
  });

  let narrative = fallbackPeriodNarrative(input.title, teamMetrics);

  try {
    narrative = await summarizeReport(
      input.title,
      teamMetrics,
      input.aiInstruction,
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
  await ensureSlotCoverageForDates([reportDate]);

  const responses = (await getSlotResponsesByDate(reportDate)) as SlotResponseRow[];
  const byEmployee = groupBy(responses, (item) => item.employee_id as string);

  await deleteReportsByDateAndKinds(reportDate, ["individual_daily", "team_daily"]);

  let individualCreated = 0;
  let individualFailed = 0;
  const failures: Array<{ employeeId?: string; employeeName?: string; reason: string }> = [];
  const individualMetricsList: EmployeeDailyMetrics[] = [];

  for (const [employeeId, rows] of Object.entries(byEmployee)) {
    const employeeName = resolveEmployeeName(rows[0]);
    const metrics = buildDailyEmployeeMetrics(employeeId, employeeName, rows, reportDate);
    individualMetricsList.push(metrics);

    let narrative = fallbackIndividualNarrative(metrics);

    try {
      narrative = await summarizeReport(
        `Daily individual report for ${employeeName} (${reportDate})`,
        metrics,
        "Write in English. Treat morning reply as optional. Afternoon and evening compliance are critical. Keep this concise and operational.",
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

  const teamMetrics = buildTeamDailyMetrics(reportDate, individualMetricsList, responses.length);
  let teamNarrative = fallbackTeamNarrative(reportDate, teamMetrics);

  try {
    teamNarrative = await summarizeReport(
      `Team daily report for ${reportDate}`,
      teamMetrics,
      "Write in English for CEO-level review. Explicitly highlight afternoon and evening compliance risk; morning reply is optional.",
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
      "Write in English as an executive weekly summary. Morning replies are optional, but afternoon and evening compliance are critical. Include concrete risks and next-week actions.",
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
      "Write in English as a monthly executive review. Morning replies are optional. Prioritize afternoon/evening compliance trend, structural risks, and corrective actions for the next month.",
  });
}
