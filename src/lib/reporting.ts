import { addDays, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { env } from "@/lib/config";
import { extractFieldReport, summarizeReport, type FieldReportExtract } from "@/lib/ai";
import { mapWithConcurrency } from "@/lib/concurrency";
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

type SlotSemanticCategory =
  | "morning_optional"
  | "noon_update"
  | "afternoon_progress"
  | "evening_summary"
  | "general_mandatory";

type SemanticCriterionResult = {
  key: string;
  label: string;
  weight: number;
  satisfied: boolean;
};

type SlotSemanticInsight = {
  slot: ReportSlotKey;
  label: string;
  category: SlotSemanticCategory;
  scorePct: number;
  qualityScorePct: number;
  evidenceScorePct: number;
  criteria: SemanticCriterionResult[];
  highlights: string[];
  gaps: string[];
  replyLength: number;
  numericSignals: number;
  keywordSignals: number;
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
    semanticScorePct: number;
    semanticPriorityScorePct: number;
    semanticQualityScorePct: number;
    semanticEvidenceScorePct: number;
    performanceScorePct: number;
  };
  semanticOverview: {
    scoringNote: string;
    prioritySlots: ReportSlotKey[];
    priorityExpectedWeight: number;
    priorityEarnedWeight: number;
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
    semantic: SlotSemanticInsight | null;
  }>;
  fieldReport?: FieldMetrics;
};

// CEO-facing performance summary derived from the rep's actual replies.
type FieldMetrics = {
  consistencyPct: number;
  fieldPresencePct: number;
  customersReached: number;
  customerTargetPct: number;
  visitTarget: number;
  pipeline: number;
  fieldPerformanceScore: number;
  blockers: string | null;
  highlight: string | null;
  summary: string;
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
  semanticExpected: number;
  semanticEarned: number;
  semanticScorePct: number;
  semanticPriorityExpected: number;
  semanticPriorityEarned: number;
  semanticPriorityScorePct: number;
  performanceScorePct: number;
  totalReplyFragments: number;
  slotMatrix: Record<ReportSlotKey, { expected: number; replied: number; missing: number }>;
  fieldReport?: FieldMetrics;
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

// Blends the CEO-facing dimensions into one fair, comparable performance score.
// `customerTarget` is the expected number of customer visits for the window
// (daily target for a day, daily target x working days for a period), so the
// same scoring is fair across daily and weekly/monthly reports.
function composeFieldMetrics(input: {
  consistencyPct: number;
  extract: FieldReportExtract;
  customerTarget: number;
}): FieldMetrics {
  const { consistencyPct, extract, customerTarget } = input;
  const fieldPresencePct = extract.locationShared ? 100 : 0;
  const customerTargetPct = customerTarget > 0
    ? Math.min(100, Number(((extract.customersVisited / customerTarget) * 100).toFixed(1)))
    : 0;
  const pipelinePct = Math.min(100, extract.leads * 50); // 2+ new leads/POs = full marks
  const fieldPerformanceScore = Number(
    (consistencyPct * 0.3 + fieldPresencePct * 0.2 + customerTargetPct * 0.35 + pipelinePct * 0.15).toFixed(1),
  );

  return {
    consistencyPct,
    fieldPresencePct,
    customersReached: extract.customersVisited,
    customerTargetPct,
    visitTarget: customerTarget,
    pipeline: extract.leads,
    fieldPerformanceScore,
    blockers: extract.blockers,
    highlight: extract.highlight,
    summary: extract.summary,
  };
}

function buildFieldMetrics(
  repliedSlots: number,
  expectedSlots: number,
  extract: FieldReportExtract,
  visitTarget: number,
): FieldMetrics {
  return composeFieldMetrics({
    consistencyPct: toPct(repliedSlots, expectedSlots),
    extract,
    customerTarget: visitTarget,
  });
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

const BANGLA_DIGIT_TO_ASCII: Record<string, string> = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

function normalizeDigits(input: string): string {
  return input.replace(/[০-৯]/g, (digit) => BANGLA_DIGIT_TO_ASCII[digit] ?? digit);
}

function normalizeSemanticText(input: string): string {
  return normalizeDigits(input)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countNumericSignals(input: string): number {
  const numbers = normalizeDigits(input).match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
  return numbers.length;
}

function countKeywordSignals(input: string, keywords: string[]): number {
  const source = normalizeSemanticText(input);
  let hits = 0;
  for (const keyword of keywords) {
    if (!keyword.trim()) continue;
    if (source.includes(normalizeSemanticText(keyword))) hits += 1;
  }
  return hits;
}

function hasAnyKeyword(input: string, keywords: string[]): boolean {
  return countKeywordSignals(input, keywords) > 0;
}

type SemanticCriterionDefinition = {
  key: string;
  label: string;
  weight: number;
  check: (text: string, numericSignals: number) => boolean;
};

function semanticCategoryForPolicy(policy: SlotPolicy): SlotSemanticCategory {
  const key = policy.key.toLowerCase();
  const label = policy.label.toLowerCase();
  const source = `${key} ${label}`;

  if (source.includes("morning")) return "morning_optional";
  if (source.includes("noon") || source.includes("midday") || source.includes("location")) return "noon_update";
  if (source.includes("afternoon") || source.includes("progress")) return "afternoon_progress";
  if (source.includes("evening") || source.includes("late") || source.includes("eod")) return "evening_summary";
  return "general_mandatory";
}

function semanticPriorityWeight(policy: SlotPolicy): number {
  const category = semanticCategoryForPolicy(policy);
  if (!policy.mandatory) return 0;
  if (category === "noon_update") return Number(Math.max(policy.weight, 1.8).toFixed(2));
  if (category === "afternoon_progress") return Number(Math.max(policy.weight, 2.8).toFixed(2));
  if (category === "evening_summary") return Number(Math.max(policy.weight, 3.2).toFixed(2));
  if (policy.critical) return Number(Math.max(policy.weight, 2.2).toFixed(2));
  return Number(Math.max(policy.weight, 1).toFixed(2));
}

function semanticBaseWeight(policy: SlotPolicy): number {
  if (!policy.mandatory) return 0;
  return Number(Math.max(policy.weight, 1).toFixed(2));
}

function isSemanticPrioritySlot(policy: SlotPolicy): boolean {
  const category = semanticCategoryForPolicy(policy);
  return category === "noon_update" || category === "afternoon_progress" || category === "evening_summary" || policy.critical;
}

function criteriaForCategory(category: SlotSemanticCategory): SemanticCriterionDefinition[] {
  const locationKeywords = [
    "লোকেশন",
    "location",
    "এলাকা",
    "area",
    "জায়গা",
    "জায়গা",
    "route",
    "মুভমেন্ট",
  ];
  const liveLocationKeywords = [
    "live location",
    "লাইভ লোকেশন",
    "লাইভ",
    "location share",
    "share",
    "পিন",
    "pin",
    "map",
    "ম্যাপ",
  ];
  const customerKeywords = [
    "customer",
    "client",
    "কাস্টমার",
    "ক্লায়েন্ট",
    "ক্লায়েন্ট",
    "visit",
    "ভিজিট",
    "follow",
    "ফলোআপ",
  ];

  if (category === "noon_update") {
    return [
      {
        key: "location_update",
        label: "Current location updated",
        weight: 32,
        check: (text) => hasAnyKeyword(text, locationKeywords),
      },
      {
        key: "live_location",
        label: "Live location/share mentioned",
        weight: 34,
        check: (text) => hasAnyKeyword(text, liveLocationKeywords),
      },
      {
        key: "coverage_signal",
        label: "Field movement / coverage mentioned",
        weight: 22,
        check: (text) => hasAnyKeyword(text, ["movement", "মুভ", "coverage", "কভার", "field", "ফিল্ড", "ভিজিট"]),
      },
      {
        key: "data_signal",
        label: "Includes concrete data point",
        weight: 12,
        check: (_text, numericSignals) => numericSignals > 0,
      },
    ];
  }

  if (category === "afternoon_progress") {
    return [
      {
        key: "lunch_status",
        label: "Lunch/health status mentioned",
        weight: 14,
        check: (text) => hasAnyKeyword(text, ["lunch", "খাবার", "খেয়েছি", "খেয়েছি", "খাইনি", "খাওয়া", "খাওয়া"]),
      },
      {
        key: "progress_update",
        label: "Work progress described",
        weight: 24,
        check: (text) => hasAnyKeyword(text, ["progress", "অগ্রগতি", "প্রগতি", "done", "complete", "চলছে", "হয়েছে", "হয়েছে"]),
      },
      {
        key: "customer_coverage",
        label: "Customer visit/follow-up count mentioned",
        weight: 30,
        check: (text, numericSignals) => numericSignals > 0 && hasAnyKeyword(text, customerKeywords),
      },
      {
        key: "blocker_signal",
        label: "Issue/blocker or support request noted",
        weight: 20,
        check: (text) => hasAnyKeyword(text, ["issue", "problem", "সমস্যা", "বাধা", "technical", "টেকনিক্যাল", "help", "support"]),
      },
      {
        key: "next_step",
        label: "Next action / plan signal present",
        weight: 12,
        check: (text) => hasAnyKeyword(text, ["next", "plan", "পরবর্তী", "প্ল্যান", "করবো", "করব", "continue", "আগাবো"]),
      },
    ];
  }

  if (category === "evening_summary") {
    return [
      {
        key: "visit_summary",
        label: "Visit/follow-up summary with quantity",
        weight: 30,
        check: (text, numericSignals) => numericSignals > 0 && hasAnyKeyword(text, customerKeywords),
      },
      {
        key: "lead_po_signal",
        label: "Lead / PO / promising client update included",
        weight: 30,
        check: (text) => hasAnyKeyword(text, ["lead", "লিড", "po", "order", "deal", "promising", "prospect", "client"]),
      },
      {
        key: "best_highlight",
        label: "Best achievement/highlight included",
        weight: 18,
        check: (text) => hasAnyKeyword(text, ["best", "ভালো", "ভাল", "গুরুত্বপূর্ণ", "highlight", "achievement", "success"]),
      },
      {
        key: "tomorrow_improvement",
        label: "Tomorrow improvement/focus mentioned",
        weight: 22,
        check: (text) => hasAnyKeyword(text, ["tomorrow", "আগামীকাল", "improve", "ইমপ্রুভ", "উন্নতি", "focus", "পরিকল্পনা"]),
      },
    ];
  }

  return [
    {
      key: "specific_update",
      label: "Specific work update present",
      weight: 55,
      check: (text) => hasAnyKeyword(text, ["visit", "meeting", "customer", "client", "update", "কাস্টমার", "আপডেট"]),
    },
    {
      key: "data_signal",
      label: "Contains measurable detail",
      weight: 25,
      check: (_text, numericSignals) => numericSignals > 0,
    },
    {
      key: "next_action",
      label: "Includes actionable next step",
      weight: 20,
      check: (text) => hasAnyKeyword(text, ["next", "plan", "follow", "আগামী", "প্ল্যান", "পরবর্তী"]),
    },
  ];
}

function evaluateSlotSemantic(policy: SlotPolicy, row: SlotResponseRow | undefined): SlotSemanticInsight | null {
  if (!row || row.is_missing) return null;

  const text = String(row.merged_text ?? "").trim();
  if (!text) return null;

  const category = semanticCategoryForPolicy(policy);
  const criteriaDefs = criteriaForCategory(category);
  const numericSignals = countNumericSignals(text);

  const criteria: SemanticCriterionResult[] = criteriaDefs.map((criterion) => ({
    key: criterion.key,
    label: criterion.label,
    weight: criterion.weight,
    satisfied: criterion.check(text, numericSignals),
  }));

  const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0);
  const earnedWeight = criteria.filter((item) => item.satisfied).reduce((sum, item) => sum + item.weight, 0);
  const baseScorePct = toPct(earnedWeight, totalWeight);

  const normalizedText = normalizeSemanticText(text);
  const keywordSignals = criteria.filter((item) => item.satisfied).length;
  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const structureBonus = Math.min(8, Math.floor(wordCount / 18) * 2);
  const numericBonus = Math.min(7, numericSignals * 2);
  const scorePct = Math.min(100, Number((baseScorePct + structureBonus + numericBonus).toFixed(2)));

  const evidenceScorePct = Number(Math.min(100, baseScorePct + Math.min(15, numericSignals * 5)).toFixed(2));
  const qualityScorePct = Number(Math.min(100, baseScorePct + structureBonus).toFixed(2));

  const highlights = criteria.filter((item) => item.satisfied).map((item) => item.label);
  const gaps = criteria.filter((item) => !item.satisfied).map((item) => item.label);

  return {
    slot: policy.key,
    label: policy.label,
    category,
    scorePct,
    qualityScorePct,
    evidenceScorePct,
    criteria,
    highlights,
    gaps,
    replyLength: text.length,
    numericSignals,
    keywordSignals,
  };
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
    const semantic = evaluateSlotSemantic(policy, row);

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
      semantic,
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

  let semanticExpected = 0;
  let semanticEarned = 0;
  let semanticPriorityExpected = 0;
  let semanticPriorityEarned = 0;
  let semanticQualityWeighted = 0;
  let semanticEvidenceWeighted = 0;

  for (const slot of slotBreakdown) {
    const policy = slotPolicies.find((item) => item.key === slot.slot);
    if (!policy || !policy.mandatory) continue;

    const baseWeight = semanticBaseWeight(policy);
    semanticExpected += baseWeight;
    const semanticScore = slot.semantic?.scorePct ?? 0;
    semanticEarned += (semanticScore / 100) * baseWeight;
    semanticQualityWeighted += ((slot.semantic?.qualityScorePct ?? 0) / 100) * baseWeight;
    semanticEvidenceWeighted += ((slot.semantic?.evidenceScorePct ?? 0) / 100) * baseWeight;

    if (isSemanticPrioritySlot(policy)) {
      const priorityWeight = semanticPriorityWeight(policy);
      semanticPriorityExpected += priorityWeight;
      semanticPriorityEarned += (semanticScore / 100) * priorityWeight;
    }
  }

  semanticExpected = Number(semanticExpected.toFixed(2));
  semanticEarned = Number(semanticEarned.toFixed(2));
  semanticPriorityExpected = Number(semanticPriorityExpected.toFixed(2));
  semanticPriorityEarned = Number(semanticPriorityEarned.toFixed(2));

  const semanticScorePct = toPct(semanticEarned, semanticExpected);
  const semanticPriorityScorePct = toPct(semanticPriorityEarned, semanticPriorityExpected);
  const semanticQualityScorePct = toPct(semanticQualityWeighted, semanticExpected);
  const semanticEvidenceScorePct = toPct(semanticEvidenceWeighted, semanticExpected);
  const performanceScorePct = Number(
    (semanticPriorityScorePct * 0.55 + toPct(weightedEarned, weightedExpected) * 0.45).toFixed(2),
  );

  const prioritySlots = slotPolicies.filter((policy) => policy.mandatory && isSemanticPrioritySlot(policy)).map((policy) => policy.key);

  return {
    reportVersion: 4,
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
      semanticScorePct,
      semanticPriorityScorePct,
      semanticQualityScorePct,
      semanticEvidenceScorePct,
      performanceScorePct,
    },
    semanticOverview: {
      scoringNote:
        "Performance combines mandatory-slot compliance with semantic quality of noon/afternoon/evening updates.",
      prioritySlots,
      priorityExpectedWeight: semanticPriorityExpected,
      priorityEarnedWeight: semanticPriorityEarned,
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
  let semanticEarned = 0;
  let semanticPriorityEarned = 0;

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
        const semantic = evaluateSlotSemantic(policy, row);
        const semanticScore = semantic?.scorePct ?? 0;
        semanticEarned += (semanticScore / 100) * semanticBaseWeight(policy);
        if (isSemanticPrioritySlot(policy)) {
          semanticPriorityEarned += (semanticScore / 100) * semanticPriorityWeight(policy);
        }
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
  const semanticExpected = Number(
    mandatoryPolicies.reduce((sum, policy) => sum + (slotMatrix[policy.key]?.expected ?? periodDays) * semanticBaseWeight(policy), 0).toFixed(2),
  );
  const priorityPolicies = mandatoryPolicies.filter((policy) => isSemanticPrioritySlot(policy));
  const semanticPriorityExpected = Number(
    priorityPolicies.reduce((sum, policy) => sum + (slotMatrix[policy.key]?.expected ?? periodDays) * semanticPriorityWeight(policy), 0).toFixed(2),
  );
  semanticEarned = Number(semanticEarned.toFixed(2));
  semanticPriorityEarned = Number(semanticPriorityEarned.toFixed(2));
  const semanticScorePct = toPct(semanticEarned, semanticExpected);
  const semanticPriorityScorePct = toPct(semanticPriorityEarned, semanticPriorityExpected);
  const weightedPerformancePct = toPct(weightedEarned, weightedExpected);
  const performanceScorePct = Number((semanticPriorityScorePct * 0.55 + weightedPerformancePct * 0.45).toFixed(2));

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
    weightedPerformancePct,
    semanticExpected,
    semanticEarned,
    semanticScorePct,
    semanticPriorityExpected,
    semanticPriorityEarned,
    semanticPriorityScorePct,
    performanceScorePct,
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
    const semanticValues = employees
      .map((item) => item.slotBreakdown.find((detail) => detail.slot === policy.key)?.semantic?.scorePct ?? null)
      .filter((value): value is number => typeof value === "number");
    const semanticAveragePct = semanticValues.length
      ? Number((semanticValues.reduce((sum, value) => sum + value, 0) / semanticValues.length).toFixed(2))
      : 0;
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
      semanticAveragePct,
    };
  });

  const averageWeighted = membersTracked
    ? Number(
        (employees.reduce((sum, item) => sum + item.summary.weightedPerformancePct, 0) / membersTracked).toFixed(2),
      )
    : 0;
  const averageSemantic = membersTracked
    ? Number(
        (employees.reduce((sum, item) => sum + item.summary.semanticScorePct, 0) / membersTracked).toFixed(2),
      )
    : 0;
  const averageSemanticPriority = membersTracked
    ? Number(
        (employees.reduce((sum, item) => sum + item.summary.semanticPriorityScorePct, 0) / membersTracked).toFixed(2),
      )
    : 0;
  const averagePerformance = membersTracked
    ? Number(
        (employees.reduce((sum, item) => sum + item.summary.performanceScorePct, 0) / membersTracked).toFixed(2),
      )
    : 0;

  const criticalPerfectCount = employees.filter(
    (item) => item.summary.criticalSlotsReplied === item.summary.criticalSlotsExpected,
  ).length;

  const atRiskMembers = employees
    .filter((item) =>
      item.summary.criticalSlotsReplied < item.summary.criticalSlotsExpected ||
      item.summary.performanceScorePct < 65,
    )
    .sort((a, b) => a.summary.performanceScorePct - b.summary.performanceScorePct)
    .slice(0, 12)
    .map((item) => ({
      employeeId: item.employee.id,
      employeeName: item.employee.name,
      criticalSlotsReplied: item.summary.criticalSlotsReplied,
      criticalSlotsExpected: item.summary.criticalSlotsExpected,
      weightedPerformancePct: item.summary.weightedPerformancePct,
      semanticPriorityScorePct: item.summary.semanticPriorityScorePct,
      performanceScorePct: item.summary.performanceScorePct,
    }));

  const withField = employees.filter((item) => item.fieldReport) as Array<
    EmployeeDailyMetrics & { fieldReport: FieldMetrics }
  >;
  const avgField = (select: (field: FieldMetrics) => number) =>
    withField.length
      ? Number((withField.reduce((sum, item) => sum + select(item.fieldReport), 0) / withField.length).toFixed(1))
      : 0;
  const fieldSummary = {
    avgFieldPerformance: avgField((field) => field.fieldPerformanceScore),
    avgConsistencyPct: avgField((field) => field.consistencyPct),
    fieldPresenceRatePct: avgField((field) => field.fieldPresencePct),
    totalCustomersReached: withField.reduce((sum, item) => sum + item.fieldReport.customersReached, 0),
    totalPipeline: withField.reduce((sum, item) => sum + item.fieldReport.pipeline, 0),
    visitTarget: withField[0]?.fieldReport.visitTarget ?? 0,
  };
  const leaderboard = [...withField]
    .sort((a, b) => b.fieldReport.fieldPerformanceScore - a.fieldReport.fieldPerformanceScore)
    .slice(0, 10)
    .map((item) => ({
      employeeId: item.employee.id,
      employeeName: item.employee.name,
      fieldPerformanceScore: item.fieldReport.fieldPerformanceScore,
      customersReached: item.fieldReport.customersReached,
      pipeline: item.fieldReport.pipeline,
      consistencyPct: item.fieldReport.consistencyPct,
      fieldPresencePct: item.fieldReport.fieldPresencePct,
    }));

  return {
    reportVersion: 4,
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
      averageSemanticScorePct: averageSemantic,
      averageSemanticPriorityScorePct: averageSemanticPriority,
      averagePerformanceScorePct: averagePerformance,
      totalReplyFragments: employees.reduce((sum, item) => sum + item.summary.totalReplyFragments, 0),
      morningParticipationPct: toPct(
        employees.filter((item) => item.summary.morningReplyReceived).length,
        membersTracked,
      ),
    },
    slotSummary,
    atRiskMembers,
    fieldSummary,
    leaderboard,
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
  const averageSemantic = membersTracked
    ? Number(
        (input.members.reduce((sum, member) => sum + member.semanticScorePct, 0) / membersTracked).toFixed(2),
      )
    : 0;
  const averageSemanticPriority = membersTracked
    ? Number(
        (input.members.reduce((sum, member) => sum + member.semanticPriorityScorePct, 0) / membersTracked).toFixed(2),
      )
    : 0;
  const averagePerformance = membersTracked
    ? Number(
        (input.members.reduce((sum, member) => sum + member.performanceScorePct, 0) / membersTracked).toFixed(2),
      )
    : 0;

  const criticalSlotCount = input.slotPolicies.filter((policy) => policy.critical).length;
  const criticalExpectedPerMember = input.periodDays * criticalSlotCount;

  const criticalPerfectCount = input.members.filter(
    (member) => member.criticalSlotsReplied === criticalExpectedPerMember,
  ).length;

  const atRiskMembers = input.members
    .filter((member) =>
      member.criticalSlotsReplied < criticalExpectedPerMember ||
      member.performanceScorePct < 65,
    )
    .sort((a, b) => a.performanceScorePct - b.performanceScorePct)
    .slice(0, 15)
    .map((member) => ({
      employeeId: member.employeeId,
      employeeName: member.employeeName,
      criticalSlotsReplied: member.criticalSlotsReplied,
      criticalSlotsExpected: member.criticalSlotsExpected,
      weightedPerformancePct: member.weightedPerformancePct,
      semanticPriorityScorePct: member.semanticPriorityScorePct,
      performanceScorePct: member.performanceScorePct,
    }));

  const topPerformers = [...input.members]
    .sort((a, b) => b.performanceScorePct - a.performanceScorePct)
    .slice(0, 8)
    .map((member) => ({
      employeeId: member.employeeId,
      employeeName: member.employeeName,
      performanceScorePct: member.performanceScorePct,
      weightedPerformancePct: member.weightedPerformancePct,
      semanticPriorityScorePct: member.semanticPriorityScorePct,
      criticalSlotsReplied: member.criticalSlotsReplied,
      criticalSlotsExpected: member.criticalSlotsExpected,
    }));

  // CEO-facing field performance over the whole period (mirrors the daily report).
  const withField = input.members.filter((member) => member.fieldReport) as Array<
    EmployeePeriodMetrics & { fieldReport: FieldMetrics }
  >;
  const avgField = (select: (field: FieldMetrics) => number) =>
    withField.length
      ? Number((withField.reduce((sum, item) => sum + select(item.fieldReport), 0) / withField.length).toFixed(1))
      : 0;
  const fieldSummary = {
    avgFieldPerformance: avgField((field) => field.fieldPerformanceScore),
    avgConsistencyPct: avgField((field) => field.consistencyPct),
    fieldPresenceRatePct: avgField((field) => field.fieldPresencePct),
    totalCustomersReached: withField.reduce((sum, item) => sum + item.fieldReport.customersReached, 0),
    totalPipeline: withField.reduce((sum, item) => sum + item.fieldReport.pipeline, 0),
    visitTarget: withField[0]?.fieldReport.visitTarget ?? 0,
  };
  const fieldRanked = [...withField].sort(
    (a, b) => b.fieldReport.fieldPerformanceScore - a.fieldReport.fieldPerformanceScore,
  );
  const leaderboard = fieldRanked.slice(0, 10).map((item) => ({
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    fieldPerformanceScore: item.fieldReport.fieldPerformanceScore,
    customersReached: item.fieldReport.customersReached,
    pipeline: item.fieldReport.pipeline,
    consistencyPct: item.fieldReport.consistencyPct,
    fieldPresencePct: item.fieldReport.fieldPresencePct,
  }));
  const champion = fieldRanked[0];
  const employeeOfPeriod = champion
    ? {
        employeeId: champion.employeeId,
        employeeName: champion.employeeName,
        periodLabel: input.kind === "team_weekly" ? "Employee of the Week" : "Employee of the Month",
        fieldPerformanceScore: champion.fieldReport.fieldPerformanceScore,
        customersReached: champion.fieldReport.customersReached,
        pipeline: champion.fieldReport.pipeline,
        consistencyPct: champion.fieldReport.consistencyPct,
        fieldPresencePct: champion.fieldReport.fieldPresencePct,
        visitTarget: champion.fieldReport.visitTarget,
        highlight: champion.fieldReport.highlight,
      }
    : null;

  return {
    reportVersion: 4,
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
      averageSemanticScorePct: averageSemantic,
      averageSemanticPriorityScorePct: averageSemanticPriority,
      averagePerformanceScorePct: averagePerformance,
      criticalPerfectCount,
      criticalPerfectPct: toPct(criticalPerfectCount, membersTracked),
    },
    slotSummary,
    topPerformers,
    atRiskMembers,
    fieldSummary,
    leaderboard,
    employeeOfPeriod,
  };
}

function fallbackIndividualNarrative(metrics: EmployeeDailyMetrics, policyInstruction: string): string {
  return [
    `${metrics.employee.name} daily summary.`,
    `Critical compliance: ${metrics.summary.criticalSlotsReplied}/${metrics.summary.criticalSlotsExpected} (${metrics.summary.criticalCompliancePct}%).`,
    `Mandatory compliance: ${metrics.summary.mandatorySlotsReplied}/${metrics.summary.mandatorySlotsExpected} (${metrics.summary.mandatoryCompliancePct}%).`,
    `Weighted performance: ${metrics.summary.weightedPerformancePct}%.`,
    `Semantic priority quality: ${metrics.summary.semanticPriorityScorePct}% (noon + afternoon + evening focus).`,
    `Final performance score: ${metrics.summary.performanceScorePct}%.`,
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
    `Average semantic priority quality: ${Number(kpi.averageSemanticPriorityScorePct ?? 0)}%.`,
    `Average final performance score: ${Number(kpi.averagePerformanceScorePct ?? 0)}%.`,
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
    `Average semantic priority quality: ${Number(kpi.averageSemanticPriorityScorePct ?? 0)}%.`,
    `Average final performance score: ${Number(kpi.averagePerformanceScorePct ?? 0)}%.`,
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

  // Turn each rep's replies across the whole window into CEO-facing field
  // metrics, benchmarked against the daily target scaled to the working days.
  const periodCustomerTarget = env.SALES_DAILY_VISIT_TARGET * Math.max(1, periodDays);
  await mapWithConcurrency(memberMetrics, 6, async (member) => {
    const employeeRows = byEmployee[member.employeeId] ?? [];
    const replyText = employeeRows
      .filter((row) => !row.is_missing && String(row.merged_text ?? "").trim())
      .map((row) => `${row.tracking_date} ${row.slot_key}: ${String(row.merged_text).trim()}`)
      .join("\n");
    if (!replyText) return;

    try {
      const extract = await extractFieldReport({
        employeeName: member.employeeName,
        date: `${input.startDate} to ${input.endDate}`,
        replies: replyText,
      });
      const repliedTotal = Object.values(member.slotMatrix).reduce((sum, slot) => sum + slot.replied, 0);
      const expectedTotal = Object.values(member.slotMatrix).reduce((sum, slot) => sum + slot.expected, 0);
      member.fieldReport = composeFieldMetrics({
        consistencyPct: toPct(repliedTotal, expectedTotal),
        extract,
        customerTarget: periodCustomerTarget,
      });
    } catch (error) {
      logError(`${input.kind} field extract failed`, {
        employeeId: member.employeeId,
        error: (error as Error).message,
      });
    }
  });

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
    modelName: env.OPENAI_MODEL,
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

  const visitTarget = env.SALES_DAILY_VISIT_TARGET;

  await mapWithConcurrency(Object.entries(byEmployee), 6, async ([employeeId, rows]) => {
    const employeeName = resolveEmployeeName(rows[0]);
    const metrics = buildDailyEmployeeMetrics(employeeId, employeeName, rows, reportDate, effectivePolicies);

    // Turn the rep's actual replies into CEO-facing field metrics.
    const replyText = rows
      .filter((row) => !row.is_missing && String(row.merged_text ?? "").trim())
      .map((row) => `${row.slot_key}: ${String(row.merged_text).trim()}`)
      .join("\n");
    const extract = await extractFieldReport({ employeeName, date: reportDate, replies: replyText });
    metrics.fieldReport = buildFieldMetrics(
      metrics.summary.repliedSlots,
      metrics.slotBreakdown.length,
      extract,
      visitTarget,
    );

    individualMetricsList.push(metrics);

    let narrative = fallbackIndividualNarrative(metrics, policyInstruction);

    try {
      narrative = await summarizeReport(
        `Daily field report for ${employeeName} (${reportDate})`,
        metrics,
        "Write 2-4 plain-English sentences for a CEO judging how this field-sales rep performed today. Cover: did they report consistently, were they present in the field (location shared), how many customers they reached versus the daily target, any new leads or POs, and one thing to improve tomorrow. Do NOT use jargon like 'mandatory', 'critical', 'semantic', or 'compliance'.",
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
        title: `Daily field report - ${employeeName}`,
        metrics,
        narrative,
        modelName: env.OPENAI_MODEL,
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
  });

  const teamMetrics = buildTeamDailyMetrics(reportDate, individualMetricsList, responses.length, effectivePolicies);
  let teamNarrative = fallbackTeamNarrative(reportDate, teamMetrics, policyInstruction);

  try {
    teamNarrative = await summarizeReport(
      `Team daily report for ${reportDate}`,
      teamMetrics,
      "Write 3-5 plain-English sentences for a CEO reviewing the field-sales team today. Cover: how consistently the team reported, how present they were in the field, total customers reached versus the team target, new leads or POs, the day's standout performer, and the main thing to fix tomorrow. Do NOT use jargon like 'mandatory', 'critical', 'semantic', or 'compliance'.",
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
      modelName: env.OPENAI_MODEL,
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
      "Write 3-5 plain-English sentences for a CEO reviewing the field-sales team's week. Cover: how consistently the team reported, how present they were in the field, total customers reached versus the team target, new leads or POs, who the standout performer was, and the main thing to fix next week. Do NOT use jargon like 'mandatory', 'critical', 'semantic', or 'compliance'.",
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
      "Write 3-6 plain-English sentences for a CEO reviewing the field-sales team's month. Cover: reporting consistency, field presence, total customers reached versus the team target, new leads or POs, the standout performer of the month, and the priorities to improve next month. Do NOT use jargon like 'mandatory', 'critical', 'semantic', or 'compliance'.",
  });
}
