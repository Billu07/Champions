import { addDays, format, startOfWeek } from "date-fns";
import { env } from "@/lib/config";
import { summarizeReport } from "@/lib/ai";
import { logError } from "@/lib/logger";
import {
  deleteReportsByDateAndKinds,
  getSlotResponsesByDate,
  getSlotResponsesInRange,
  insertReport,
} from "@/lib/repository";

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const groupKey = key(item);
    acc[groupKey] = acc[groupKey] ?? [];
    acc[groupKey].push(item);
    return acc;
  }, {});
}

function fallbackIndividualNarrative(input: {
  employeeName: string;
  repliedSlots: number;
  missingSlots: number;
  totalReplies: number;
}): string {
  return [
    `${input.employeeName} daily summary:`,
    `Replied slots: ${input.repliedSlots}. Missing slots: ${input.missingSlots}. Total reply fragments: ${input.totalReplies}.`,
    "Priority: follow up on missed slots and maintain timely structured replies.",
  ].join(" ");
}

function fallbackTeamNarrative(input: {
  totalMembers: number;
  teamRepliedSlots: number;
  teamMissingSlots: number;
  teamReplies: number;
  reportDate: string;
}): string {
  return [
    `Team daily summary for ${input.reportDate}:`,
    `Members covered: ${input.totalMembers}. Replied slots: ${input.teamRepliedSlots}. Missing slots: ${input.teamMissingSlots}.`,
    `Total reply fragments: ${input.teamReplies}.`,
    "Priority: close response gaps in missing slots and enforce slot-level accountability.",
  ].join(" ");
}

function fallbackWeeklyNarrative(input: {
  start: string;
  end: string;
  members: number;
  replied: number;
  missing: number;
  replyRate: number;
}): string {
  return [
    `Weekly team summary (${input.start} to ${input.end}):`,
    `Members covered: ${input.members}. Replied slots: ${input.replied}. Missing slots: ${input.missing}. Reply rate: ${input.replyRate}%.`,
    "Priority: reduce missing slot count and improve consistency for next week.",
  ].join(" ");
}

export async function generateDailyReports(reportDate: string) {
  const responses = await getSlotResponsesByDate(reportDate);
  const byEmployee = groupBy(responses, (item) => item.employee_id as string);

  // Make daily generation idempotent for the same date.
  await deleteReportsByDateAndKinds(reportDate, ["individual_daily", "team_daily"]);

  let individualCreated = 0;
  let individualFailed = 0;
  const failures: Array<{ employeeId?: string; employeeName?: string; reason: string }> = [];

  for (const [employeeId, rows] of Object.entries(byEmployee)) {
    const repliedSlots = rows.filter((row) => !row.is_missing).length;
    const missingSlots = rows.filter((row) => row.is_missing).length;
    const totalReplies = rows.reduce((sum, row) => sum + (row.reply_count ?? 0), 0);
    const employeeName = (rows[0] as { employees?: { full_name?: string } }).employees?.full_name ?? "Unknown";

    const metrics = {
      employeeName,
      repliedSlots,
      missingSlots,
      totalReplies,
      slotDetails: rows.map((row) => ({
        slot: row.slot_key,
        missing: row.is_missing,
        replyCount: row.reply_count,
        mergedText: row.merged_text,
      })),
    };

    let narrative = fallbackIndividualNarrative({
      employeeName,
      repliedSlots,
      missingSlots,
      totalReplies,
    });

    try {
      narrative = await summarizeReport(
        `Daily individual report for ${employeeName}`,
        metrics,
        "Write in English. Keep it concise and operational.",
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
        title: `Daily report - ${employeeName}`,
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

  const totalMembers = Object.keys(byEmployee).length;
  const teamRepliedSlots = responses.filter((row) => !row.is_missing).length;
  const teamMissingSlots = responses.filter((row) => row.is_missing).length;
  const teamReplies = responses.reduce((sum, row) => sum + (row.reply_count ?? 0), 0);

  const teamMetrics = {
    totalMembers,
    teamRepliedSlots,
    teamMissingSlots,
    teamReplies,
    reportDate,
  };

  let teamNarrative = fallbackTeamNarrative({
    totalMembers,
    teamRepliedSlots,
    teamMissingSlots,
    teamReplies,
    reportDate,
  });

  try {
    teamNarrative = await summarizeReport(
      `Team daily report for ${reportDate}`,
      teamMetrics,
      "Write in English for CEO-level review.",
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
      title: `Team daily summary - ${reportDate}`,
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
    totalMembers,
    responses: responses.length,
    individualCreated,
    individualFailed,
    failures,
  };
}

export function weeklyRangeForDhakaDate(date: Date): { start: string; end: string } {
  const weekStart = startOfWeek(date, { weekStartsOn: 6 });
  const weekEnd = addDays(weekStart, 6);

  return {
    start: format(weekStart, "yyyy-MM-dd"),
    end: format(weekEnd, "yyyy-MM-dd"),
  };
}

export async function generateWeeklyReport(anchorDate: Date) {
  const range = weeklyRangeForDhakaDate(anchorDate);
  const rows = await getSlotResponsesInRange(range.start, range.end);

  const members = new Set(rows.map((row) => row.employee_id as string));
  const missing = rows.filter((row) => row.is_missing).length;
  const replied = rows.filter((row) => !row.is_missing).length;

  const metrics = {
    range,
    members: members.size,
    totalSlotRows: rows.length,
    replied,
    missing,
    replyRate: rows.length > 0 ? Number(((replied / rows.length) * 100).toFixed(2)) : 0,
  };

  let narrative = fallbackWeeklyNarrative({
    start: range.start,
    end: range.end,
    members: metrics.members,
    replied,
    missing,
    replyRate: metrics.replyRate,
  });

  try {
    narrative = await summarizeReport(
      `Weekly team report (${range.start} to ${range.end})`,
      metrics,
      "Write in English as a weekly executive summary with risks and next-week action points.",
    );
  } catch (error) {
    logError("Weekly AI summary failed", {
      start: range.start,
      end: range.end,
      error: (error as Error).message,
    });
  }

  await insertReport({
    kind: "team_weekly",
    reportDate: range.end,
    title: `Team weekly summary - ${range.start} to ${range.end}`,
    metrics,
    narrative,
    modelName: env.GEMINI_MODEL,
  });

  return metrics;
}
