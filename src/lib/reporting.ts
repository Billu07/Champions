import { addDays, format, startOfWeek } from "date-fns";
import { env } from "@/lib/config";
import { summarizeReport } from "@/lib/ai";
import {
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

export async function generateDailyReports(reportDate: string) {
  const responses = await getSlotResponsesByDate(reportDate);
  const byEmployee = groupBy(responses, (item) => item.employee_id as string);

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

    const narrative = await summarizeReport(
      `Daily individual report for ${employeeName}`,
      metrics,
      "Write in English. Keep it concise and operational.",
    );

    await insertReport({
      kind: "individual_daily",
      reportDate,
      employeeId,
      title: `Daily report - ${employeeName}`,
      metrics,
      narrative,
      modelName: env.GEMINI_MODEL,
    });
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

  const teamNarrative = await summarizeReport(
    `Team daily report for ${reportDate}`,
    teamMetrics,
    "Write in English for CEO-level review.",
  );

  await insertReport({
    kind: "team_daily",
    reportDate,
    title: `Team daily summary - ${reportDate}`,
    metrics: teamMetrics,
    narrative: teamNarrative,
    modelName: env.GEMINI_MODEL,
  });

  return {
    reportDate,
    totalMembers,
    responses: responses.length,
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

  const narrative = await summarizeReport(
    `Weekly team report (${range.start} to ${range.end})`,
    metrics,
    "Write in English as a weekly executive summary with risks and next-week action points.",
  );

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
