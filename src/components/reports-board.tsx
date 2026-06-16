"use client";

import { useMemo, useState } from "react";

type Report = {
  id: string;
  kind: "individual_daily" | "team_daily" | "team_weekly" | "team_monthly";
  report_date: string;
  title: string;
  narrative: string;
  metrics: Record<string, unknown>;
  model_name: string;
  created_at: string;
  employees?: { full_name?: string } | Array<{ full_name?: string }>;
};

type ReportsBoardProps = {
  initialReports: Report[];
  brandName: string;
  brandTagline: string;
};

type ReportKindFilter = Report["kind"] | "all";

const KIND_LABEL: Record<Report["kind"], string> = {
  individual_daily: "Individual Daily",
  team_daily: "Team Daily",
  team_weekly: "Team Weekly",
  team_monthly: "Team Monthly",
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asRecord(item));
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pct(value: number): string {
  return `${Number(value).toFixed(2)}%`;
}

function resolveEmployeeName(report: Report): string {
  if (!report.employees) return "";
  if (Array.isArray(report.employees)) return report.employees[0]?.full_name ?? "";
  return report.employees.full_name ?? "";
}

// Final performance score for filtering/sorting: per-employee for individual
// reports, team average for team reports. Null when the report has no score.
function reportPerformanceScore(report: Report): number | null {
  const metrics = asRecord(report.metrics);
  if (report.kind === "individual_daily") {
    const summary = asRecord(metrics.summary);
    return "performanceScorePct" in summary ? asNumber(summary.performanceScorePct) : null;
  }
  const kpi = asRecord(metrics.kpi);
  return "averagePerformanceScorePct" in kpi ? asNumber(kpi.averagePerformanceScorePct) : null;
}

type FieldReport = {
  consistencyPct: number;
  fieldPresencePct: number;
  customersReached: number;
  visitTarget: number;
  pipeline: number;
  fieldPerformanceScore: number;
  blockers: string | null;
  highlight: string | null;
};

function getFieldReport(report: Report): FieldReport | null {
  const fr = asRecord(report.metrics).fieldReport;
  if (!fr || typeof fr !== "object") return null;
  const f = fr as Record<string, unknown>;
  return {
    consistencyPct: asNumber(f.consistencyPct),
    fieldPresencePct: asNumber(f.fieldPresencePct),
    customersReached: asNumber(f.customersReached),
    visitTarget: asNumber(f.visitTarget),
    pipeline: asNumber(f.pipeline),
    fieldPerformanceScore: asNumber(f.fieldPerformanceScore),
    blockers: asString(f.blockers) || null,
    highlight: asString(f.highlight) || null,
  };
}

function getTeamFieldSummary(report: Report) {
  const fs = asRecord(report.metrics).fieldSummary;
  if (!fs || typeof fs !== "object" || !Object.keys(fs).length) return null;
  const f = fs as Record<string, unknown>;
  return {
    avgFieldPerformance: asNumber(f.avgFieldPerformance),
    avgConsistencyPct: asNumber(f.avgConsistencyPct),
    fieldPresenceRatePct: asNumber(f.fieldPresenceRatePct),
    totalCustomersReached: asNumber(f.totalCustomersReached),
    totalPipeline: asNumber(f.totalPipeline),
  };
}

type LeaderboardRow = {
  name: string;
  score: number;
  customers: number;
  pipeline: number;
  consistencyPct: number;
  fieldPresencePct: number;
};

function getLeaderboard(report: Report): LeaderboardRow[] {
  return asArray(asRecord(report.metrics).leaderboard).map((row) => ({
    name: asString(row.employeeName) || asString(row.employeeId) || "Unknown",
    score: asNumber(row.fieldPerformanceScore),
    customers: asNumber(row.customersReached),
    pipeline: asNumber(row.pipeline),
    consistencyPct: asNumber(row.consistencyPct),
    fieldPresencePct: asNumber(row.fieldPresencePct),
  }));
}

type EmployeeOfPeriod = {
  name: string;
  periodLabel: string;
  score: number;
  customers: number;
  visitTarget: number;
  pipeline: number;
  consistencyPct: number;
  fieldPresencePct: number;
  highlight: string | null;
};

function getEmployeeOfPeriod(report: Report): EmployeeOfPeriod | null {
  const eop = asRecord(report.metrics).employeeOfPeriod;
  if (!eop || typeof eop !== "object") return null;
  const e = eop as Record<string, unknown>;
  const name = asString(e.employeeName) || asString(e.employeeId);
  if (!name) return null;
  return {
    name,
    periodLabel: asString(e.periodLabel) || "Top Performer",
    score: asNumber(e.fieldPerformanceScore),
    customers: asNumber(e.customersReached),
    visitTarget: asNumber(e.visitTarget),
    pipeline: asNumber(e.pipeline),
    consistencyPct: asNumber(e.consistencyPct),
    fieldPresencePct: asNumber(e.fieldPresencePct),
    highlight: asString(e.highlight) || null,
  };
}

type BadgeStats = {
  fieldPerformanceScore: number;
  consistencyPct: number;
  fieldPresencePct: number;
  customersReached: number;
  visitTarget: number;
  pipeline: number;
};

// Recognition badges derived from a rep's stats — plain CEO language.
function computeBadges(stats: BadgeStats): Array<{ label: string; icon: string }> {
  const badges: Array<{ label: string; icon: string }> = [];
  if (stats.fieldPerformanceScore >= 85) badges.push({ icon: "🏆", label: "Top Performer" });
  if (stats.visitTarget > 0 && stats.customersReached >= stats.visitTarget) badges.push({ icon: "🎯", label: "Target Crusher" });
  if (stats.consistencyPct >= 90) badges.push({ icon: "🔁", label: "Always Reporting" });
  if (stats.fieldPresencePct >= 100) badges.push({ icon: "📍", label: "On the Field" });
  if (stats.pipeline >= 2) badges.push({ icon: "💼", label: "Deal Maker" });
  return badges;
}

function Badges({ stats }: { stats: BadgeStats }) {
  const badges = computeBadges(stats);
  if (!badges.length) return null;
  return (
    <div className="badge-row">
      {badges.map((badge) => (
        <span className="badge" key={badge.label}>
          <span aria-hidden="true">{badge.icon}</span> {badge.label}
        </span>
      ))}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <span className="avatar" style={{ background: `hsl(${hue} 45% 92%)`, color: `hsl(${hue} 55% 30%)` }} aria-hidden="true">
      {initials}
    </span>
  );
}

type ProfilePoint = {
  id: string;
  date: string;
  score: number;
  customers: number;
  pipeline: number;
  consistency: number;
  fieldPresence: number;
  visitTarget: number;
  highlight: string | null;
  narrative: string;
};

type Profile = {
  name: string;
  points: ProfilePoint[];
  avgScore: number;
  avgConsistency: number;
  avgFieldPresence: number;
  totalCustomers: number;
  totalPipeline: number;
  days: number;
  badgeStats: BadgeStats;
};

// Aggregates a rep's daily reports (already loaded client-side) into a profile —
// no extra API call. Trend, averages, totals and recognition badges.
function buildProfile(reports: Report[], name: string): Profile {
  const points: ProfilePoint[] = reports
    .filter((report) => report.kind === "individual_daily" && resolveEmployeeName(report) === name)
    .map((report) => ({ report, field: getFieldReport(report) }))
    .filter((item): item is { report: Report; field: FieldReport } => Boolean(item.field))
    .map(({ report, field }) => ({
      id: report.id,
      date: report.report_date,
      score: field.fieldPerformanceScore,
      customers: field.customersReached,
      pipeline: field.pipeline,
      consistency: field.consistencyPct,
      fieldPresence: field.fieldPresencePct,
      visitTarget: field.visitTarget,
      highlight: field.highlight,
      narrative: report.narrative,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const n = points.length;
  const sum = (select: (point: ProfilePoint) => number) => points.reduce((acc, point) => acc + select(point), 0);
  const avg = (select: (point: ProfilePoint) => number) => (n ? Number((sum(select) / n).toFixed(1)) : 0);
  const avgScore = avg((point) => point.score);
  const avgConsistency = avg((point) => point.consistency);
  const avgFieldPresence = avg((point) => point.fieldPresence);

  return {
    name,
    points,
    avgScore,
    avgConsistency,
    avgFieldPresence,
    totalCustomers: sum((point) => point.customers),
    totalPipeline: sum((point) => point.pipeline),
    days: n,
    badgeStats: {
      fieldPerformanceScore: avgScore,
      consistencyPct: avgConsistency,
      fieldPresencePct: avgFieldPresence,
      customersReached: n ? Math.round(sum((point) => point.customers) / n) : 0,
      visitTarget: points[n - 1]?.visitTarget ?? 0,
      pipeline: n ? Math.round(sum((point) => point.pipeline) / n) : 0,
    },
  };
}

function Sparkline({ points }: { points: ProfilePoint[] }) {
  const recent = points.slice(-14);
  if (!recent.length) return null;
  return (
    <div className="sparkline" role="img" aria-label="Field performance trend">
      {recent.map((point, index) => (
        <span className="sparkline-bar" key={`${point.date}-${index}`} title={`${point.date}: ${point.score}%`}>
          <span style={{ height: `${Math.max(4, Math.min(100, point.score))}%` }} />
        </span>
      ))}
    </div>
  );
}

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString();
}

function summaryRowsForReport(report: Report): Array<{ label: string; value: string }> {
  const metrics = asRecord(report.metrics);
  const summary = asRecord(metrics.summary);
  const kpi = asRecord(metrics.kpi);

  if (report.kind === "individual_daily") {
    return [
      {
        label: "Critical Compliance",
        value: `${asNumber(summary.criticalSlotsReplied)}/${asNumber(summary.criticalSlotsExpected)} (${pct(asNumber(summary.criticalCompliancePct))})`,
      },
      {
        label: "Mandatory Compliance",
        value: `${asNumber(summary.mandatorySlotsReplied)}/${asNumber(summary.mandatorySlotsExpected)} (${pct(asNumber(summary.mandatoryCompliancePct))})`,
      },
      {
        label: "Weighted Performance",
        value: pct(asNumber(summary.weightedPerformancePct)),
      },
      {
        label: "Semantic Priority",
        value: pct(asNumber(summary.semanticPriorityScorePct)),
      },
      {
        label: "Final Performance",
        value: pct(asNumber(summary.performanceScorePct)),
      },
      {
        label: "Reply Fragments",
        value: String(asNumber(summary.totalReplyFragments)),
      },
    ];
  }

  const membersTracked = asNumber(kpi.membersTracked || metrics.members || metrics.totalMembers);
  const avgWeighted = asNumber(kpi.averageWeightedPerformancePct || metrics.replyRate);
  const avgSemanticPriority = asNumber(kpi.averageSemanticPriorityScorePct);
  const avgFinal = asNumber(kpi.averagePerformanceScorePct);
  const criticalPerfect = asNumber(kpi.criticalPerfectCount || kpi.criticalCompliancePct || 0);
  const fragments = asNumber(kpi.totalReplyFragments || metrics.teamReplies || metrics.totalReplies || 0);

  return [
    { label: "Members Tracked", value: String(membersTracked) },
    {
      label: report.kind === "team_daily" ? "Critical Perfect Members" : "Critical Perfect",
      value: report.kind === "team_daily" ? String(criticalPerfect) : pct(asNumber(kpi.criticalPerfectPct)),
    },
    { label: "Avg Weighted Performance", value: pct(avgWeighted) },
    { label: "Avg Semantic Priority", value: pct(avgSemanticPriority) },
    { label: "Avg Final Performance", value: pct(avgFinal) },
    { label: "Reply Fragments", value: String(fragments) },
  ];
}

function extractSlotRows(report: Report): Array<{
  label: string;
  expected: number;
  replied: number;
  missing: number;
  compliancePct: number;
  critical: boolean;
  semanticScorePct: number | null;
}> {
  const metrics = asRecord(report.metrics);

  if (report.kind === "individual_daily") {
    const slotBreakdown = asArray(metrics.slotBreakdown);
    return slotBreakdown.map((slot) => ({
      label: asString(slot.label) || asString(slot.slot),
      expected: 1,
      replied: slot.replied ? 1 : 0,
      missing: slot.replied ? 0 : 1,
      compliancePct: slot.replied ? 100 : 0,
      critical: Boolean(slot.critical),
      semanticScorePct: slot.semantic ? asNumber(asRecord(slot.semantic).scorePct) : null,
    }));
  }

  const slotSummary = asArray(metrics.slotSummary);
  return slotSummary.map((slot) => ({
    label: asString(slot.label) || asString(slot.slot),
    expected: asNumber(slot.expected),
    replied: asNumber(slot.replied),
    missing: asNumber(slot.missing),
    compliancePct: asNumber(slot.compliancePct),
    critical: Boolean(slot.critical),
    semanticScorePct: typeof slot.semanticAveragePct === "number" ? asNumber(slot.semanticAveragePct) : null,
  }));
}

function extractRiskRows(report: Report): Array<{ name: string; score: string }> {
  const metrics = asRecord(report.metrics);
  const atRisk = asArray(metrics.atRiskMembers);
  return atRisk.slice(0, 8).map((row) => ({
    name: asString(row.employeeName) || asString(row.employeeId),
    score:
      `Final ${pct(asNumber(row.performanceScorePct) || asNumber(row.weightedPerformancePct))}` +
      ` | Semantic ${pct(asNumber(row.semanticPriorityScorePct))}` +
      ` | Weighted ${pct(asNumber(row.weightedPerformancePct))}` +
      ` | Critical ${asNumber(row.criticalSlotsReplied)}/${asNumber(row.criticalSlotsExpected)}`,
  }));
}

function lastAutoTableY(doc: unknown, fallback: number): number {
  const candidate = doc as { lastAutoTable?: { finalY?: number } };
  const y = candidate.lastAutoTable?.finalY;
  return typeof y === "number" ? y : fallback;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120);
}

function fileDateStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read logo"));
    reader.readAsDataURL(blob);
  });
}

export function ReportsBoard({ initialReports, brandName, brandTagline }: ReportsBoardProps) {
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [kindFilter, setKindFilter] = useState<ReportKindFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [perfMin, setPerfMin] = useState("");
  const [perfMax, setPerfMax] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "perf_asc" | "perf_desc">("date");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportingReportId, setExportingReportId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

  const pageSize = 15;

  async function loadReports() {
    setStatus("Loading reports...");
    const params = new URLSearchParams();
    params.set("limit", "300");
    if (kindFilter !== "all") params.set("kind", kindFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    const res = await fetch(`/api/reports?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus((json as { error?: string }).error ?? "Failed to load reports");
      return;
    }

    const rows = (json as { reports?: Report[] }).reports ?? [];
    setReports(rows);
    setPage(1);
    setStatus(`Loaded ${rows.length} reports.`);
  }

  async function loadBrandLogoDataUrl(): Promise<string | null> {
    try {
      const res = await fetch("/brand/logo-c.png", { cache: "force-cache" });
      if (!res.ok) return null;
      const blob = await res.blob();
      return blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  async function exportSingleReportPdf(report: Report) {
    setExportingReportId(report.id);
    setExporting(true);
    setStatus("Generating branded PDF...");

    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const logoDataUrl = await loadBrandLogoDataUrl();

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      let y = margin;

      const ensureSpace = (needed: number) => {
        if (y + needed > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
      };

      doc.setFillColor(15, 76, 129);
      doc.rect(0, 0, pageWidth, 68, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.text(`${brandName} Report`, margin, 30);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(brandTagline, margin, 48);

      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, "PNG", pageWidth - margin - 112, 12, 92, 46);
        } catch {
          // Keep export resilient even if logo decoding fails.
        }
      }

      doc.setTextColor(16, 24, 40);
      y = 88;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(report.title, margin, y);
      y += 16;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(71, 84, 103);
      doc.text(
        `${KIND_LABEL[report.kind]} | ${report.report_date} | Model: ${report.model_name}${resolveEmployeeName(report) ? ` | ${resolveEmployeeName(report)}` : ""}`,
        margin,
        y,
      );
      y += 14;

      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
      y += 14;

      doc.setTextColor(16, 24, 40);
      const narrativeLines = doc.splitTextToSize(report.narrative, pageWidth - margin * 2);
      ensureSpace(narrativeLines.length * 12 + 10);
      doc.text(narrativeLines, margin, y);
      y += narrativeLines.length * 12 + 8;

      const kpiRows = summaryRowsForReport(report).map((item) => [item.label, item.value]);
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [15, 76, 129] },
        head: [["KPI", "Value"]],
        body: kpiRows,
      });
      y = lastAutoTableY(doc, y + 50) + 8;

      const slotRows = extractSlotRows(report);
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [53, 81, 110] },
        head: [["Slot", "Expected", "Replied", "Missing", "Compliance", "Semantic"]],
        body: slotRows.map((slot) => [
          `${slot.label}${slot.critical ? " (critical)" : ""}`,
          String(slot.expected),
          String(slot.replied),
          String(slot.missing),
          pct(slot.compliancePct),
          slot.semanticScorePct === null ? "-" : pct(slot.semanticScorePct),
        ]),
      });
      y = lastAutoTableY(doc, y + 70) + 8;

      const risks = extractRiskRows(report);
      if (risks.length > 0) {
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          theme: "grid",
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [180, 35, 24] },
          head: [["At-Risk Member", "Score"]],
          body: risks.map((risk) => [risk.name, risk.score]),
        });
      }

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i += 1) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 14, { align: "right" });
      }

      const fileName = `${sanitizeFilename(brandName)}_${sanitizeFilename(report.kind)}_${fileDateStamp(report.report_date)}_${sanitizeFilename(report.title)}.pdf`;
      doc.save(fileName);
      setStatus("Branded PDF exported.");
    } catch (error) {
      setStatus(`PDF export failed: ${(error as Error).message}`);
    } finally {
      setExporting(false);
      setExportingReportId(null);
    }
  }

  const employeeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const report of reports) {
      const name = resolveEmployeeName(report);
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = perfMin.trim() === "" ? null : Number(perfMin);
    const max = perfMax.trim() === "" ? null : Number(perfMax);
    const hasMin = min !== null && Number.isFinite(min);
    const hasMax = max !== null && Number.isFinite(max);

    const result = reports.filter((report) => {
      if (employeeFilter && resolveEmployeeName(report) !== employeeFilter) return false;

      if (hasMin || hasMax) {
        const score = reportPerformanceScore(report);
        if (score === null) return false;
        if (hasMin && score < (min as number)) return false;
        if (hasMax && score > (max as number)) return false;
      }

      if (q) {
        const employee = resolveEmployeeName(report);
        const matches =
          report.title.toLowerCase().includes(q) ||
          report.narrative.toLowerCase().includes(q) ||
          report.kind.toLowerCase().includes(q) ||
          report.report_date.includes(q) ||
          employee.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });

    if (sortBy === "date") {
      result.sort((a, b) => (a.report_date < b.report_date ? 1 : a.report_date > b.report_date ? -1 : 0));
    } else {
      const dir = sortBy === "perf_asc" ? 1 : -1;
      result.sort((a, b) => {
        const sa = reportPerformanceScore(a);
        const sb = reportPerformanceScore(b);
        if (sa === null && sb === null) return 0;
        if (sa === null) return 1; // reports without a score sort last
        if (sb === null) return -1;
        return (sa - sb) * dir;
      });
    }

    return result;
  }, [reports, search, employeeFilter, perfMin, perfMax, sortBy]);

  const summary = useMemo(() => {
    return {
      total: filteredReports.length,
      individual: filteredReports.filter((item) => item.kind === "individual_daily").length,
      teamDaily: filteredReports.filter((item) => item.kind === "team_daily").length,
      teamWeekly: filteredReports.filter((item) => item.kind === "team_weekly").length,
      teamMonthly: filteredReports.filter((item) => item.kind === "team_monthly").length,
    };
  }, [filteredReports]);

  const profile = useMemo(
    () => (profileName ? buildProfile(reports, profileName) : null),
    [reports, profileName],
  );

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pagedReports = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredReports.slice(start, start + pageSize);
  }, [currentPage, filteredReports]);

  return (
    <section className="grid reports-board" style={{ gap: 14 }}>
      <article className="card grid reports-filters" style={{ gap: 10 }}>
        <div className="row">
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Type</span>
            <select
              value={kindFilter}
              onChange={(event) => {
                setKindFilter(event.target.value as ReportKindFilter);
                setPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="individual_daily">Individual Daily</option>
              <option value="team_daily">Team Daily</option>
              <option value="team_weekly">Team Weekly</option>
              <option value="team_monthly">Team Monthly</option>
            </select>
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>From</span>
            <input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>To</span>
            <input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Search</span>
            <input
              className="input"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Title, narrative, employee"
            />
          </label>
        </div>

        <div className="row">
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Employee</span>
            <select
              value={employeeFilter}
              onChange={(event) => {
                setEmployeeFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All employees</option>
              {employeeOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Performance min %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={perfMin}
              onChange={(event) => {
                setPerfMin(event.target.value);
                setPage(1);
              }}
              placeholder="e.g. 0"
            />
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Performance max %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={perfMax}
              onChange={(event) => {
                setPerfMax(event.target.value);
                setPage(1);
              }}
              placeholder="e.g. 65 (at-risk)"
            />
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Sort</span>
            <select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as "date" | "perf_asc" | "perf_desc");
                setPage(1);
              }}
            >
              <option value="date">Newest first</option>
              <option value="perf_asc">Performance: low → high</option>
              <option value="perf_desc">Performance: high → low</option>
            </select>
          </label>
        </div>

        <div className="inline" style={{ justifyContent: "space-between" }}>
          <div className="inline">
            <button onClick={() => void loadReports()}>Apply Filters</button>
            <span className="muted" style={{ fontSize: 12 }}>
              Type &amp; dates load from the server; employee, performance, sort &amp; search filter instantly.
            </span>
          </div>
          <span className="muted">
            {status || "Each report is exported as a separate branded PDF from its own card."}
          </span>
        </div>
      </article>

      <div className="kpi-grid">
        <article className="card kpi-card">
          <p className="kpi-label">Total</p>
          <p className="kpi-value">{summary.total}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Individual Daily</p>
          <p className="kpi-value">{summary.individual}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Team Daily</p>
          <p className="kpi-value">{summary.teamDaily}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Team Weekly</p>
          <p className="kpi-value">{summary.teamWeekly}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Team Monthly</p>
          <p className="kpi-value">{summary.teamMonthly}</p>
        </article>
      </div>

      <div className="inline" style={{ justifyContent: "space-between" }}>
        <span className="muted">Page {currentPage} of {totalPages}</span>
        <div className="inline">
          <button className="ghost" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            Previous
          </button>
          <button className="ghost" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
            Next
          </button>
        </div>
      </div>

      {pagedReports.map((report) => {
        const employee = resolveEmployeeName(report);
        const slotRows = extractSlotRows(report);
        const riskRows = extractRiskRows(report);
        const summaryRows = summaryRowsForReport(report);
        const field = report.kind === "individual_daily" ? getFieldReport(report) : null;
        const teamField = report.kind !== "individual_daily" ? getTeamFieldSummary(report) : null;
        const leaderboard = teamField ? getLeaderboard(report) : [];
        const eop = report.kind === "team_weekly" || report.kind === "team_monthly" ? getEmployeeOfPeriod(report) : null;
        const hasFieldData = Boolean(field || teamField);

        return (
          <article className="card report-card" key={report.id}>
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <div className="inline" style={{ gap: 10 }}>
                {employee ? (
                  <button type="button" className="profile-trigger" onClick={() => setProfileName(employee)} title="View profile">
                    <Avatar name={employee} />
                    <h2>{report.title}</h2>
                  </button>
                ) : (
                  <h2>{report.title}</h2>
                )}
              </div>
              <div className="inline">
                <span className="pill">{KIND_LABEL[report.kind]}</span>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => void exportSingleReportPdf(report)}
                  disabled={exporting}
                >
                  {exportingReportId === report.id ? "Exporting..." : "Download Branded PDF"}
                </button>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {formatDate(report.report_date)}{employee ? ` · ${employee}` : ""}
            </p>

            {field ? (
              <div className="report-field">
                <div className="report-score">
                  <span className="report-score-value">{field.fieldPerformanceScore}%</span>
                  <span className="muted">Field Performance</span>
                </div>
                <div className="report-stats">
                  <div className="report-stat"><span>Consistency</span><strong>{field.consistencyPct}%</strong></div>
                  <div className="report-stat"><span>Field Presence</span><strong>{field.fieldPresencePct}%</strong></div>
                  <div className="report-stat"><span>Customers</span><strong>{field.customersReached}/{field.visitTarget}</strong></div>
                  <div className="report-stat"><span>New Pipeline</span><strong>{field.pipeline}</strong></div>
                </div>
                <Badges
                  stats={{
                    fieldPerformanceScore: field.fieldPerformanceScore,
                    consistencyPct: field.consistencyPct,
                    fieldPresencePct: field.fieldPresencePct,
                    customersReached: field.customersReached,
                    visitTarget: field.visitTarget,
                    pipeline: field.pipeline,
                  }}
                />
                {field.highlight ? <p className="muted" style={{ margin: 0 }}>🌟 {field.highlight}</p> : null}
                {field.blockers ? <p className="muted" style={{ margin: 0 }}>⚠️ {field.blockers}</p> : null}
              </div>
            ) : null}

            {eop ? (
              <button type="button" className="employee-of-period" onClick={() => setProfileName(eop.name)} title="View profile">
                <span className="eop-ribbon">{eop.periodLabel}</span>
                <Avatar name={eop.name} />
                <div className="eop-body">
                  <strong className="eop-name">{eop.name}</strong>
                  <span className="muted eop-meta">
                    {eop.score}% field performance · {eop.customers}/{eop.visitTarget} customers · {eop.pipeline} new pipeline
                  </span>
                  <Badges
                    stats={{
                      fieldPerformanceScore: eop.score,
                      consistencyPct: eop.consistencyPct,
                      fieldPresencePct: eop.fieldPresencePct,
                      customersReached: eop.customers,
                      visitTarget: eop.visitTarget,
                      pipeline: eop.pipeline,
                    }}
                  />
                </div>
              </button>
            ) : null}

            {teamField ? (
              <div className="report-field">
                <div className="report-stats">
                  <div className="report-stat"><span>Avg Performance</span><strong>{teamField.avgFieldPerformance}%</strong></div>
                  <div className="report-stat"><span>Consistency</span><strong>{teamField.avgConsistencyPct}%</strong></div>
                  <div className="report-stat"><span>Field Presence</span><strong>{teamField.fieldPresenceRatePct}%</strong></div>
                  <div className="report-stat"><span>Customers Reached</span><strong>{teamField.totalCustomersReached}</strong></div>
                  <div className="report-stat"><span>New Pipeline</span><strong>{teamField.totalPipeline}</strong></div>
                </div>
                {leaderboard.length ? (
                  <div className="leaderboard">
                    {leaderboard.map((row, index) => (
                      <button
                        type="button"
                        className="leaderboard-row"
                        key={`${row.name}-${index}`}
                        onClick={() => setProfileName(row.name)}
                        title="View profile"
                      >
                        <span className="leaderboard-rank">{index === 0 ? "★" : index + 1}</span>
                        <Avatar name={row.name} />
                        <span className="leaderboard-name">{row.name}</span>
                        <span className="leaderboard-bar"><span style={{ width: `${Math.max(4, Math.min(100, row.score))}%` }} /></span>
                        <span className="leaderboard-score">{row.score}%</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!hasFieldData ? (
              <div className="inline">
                {summaryRows.map((row) => (
                  <span className="pill" key={`${report.id}-${row.label}`}>{row.label}: {row.value}</span>
                ))}
              </div>
            ) : null}

            <p>{report.narrative}</p>

            <details>
              <summary>Slot Compliance Details</summary>
              <div className="table-wrap mobile-cards" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Expected</th>
                      <th>Replied</th>
                      <th>Missing</th>
                      <th>Compliance</th>
                      <th>Semantic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slotRows.length ? slotRows.map((slot) => (
                      <tr key={`${report.id}-${slot.label}`}>
                        <td data-label="Slot">{slot.label}{slot.critical ? " (critical)" : ""}</td>
                        <td data-label="Expected">{slot.expected}</td>
                        <td data-label="Replied">{slot.replied}</td>
                        <td data-label="Missing">{slot.missing}</td>
                        <td data-label="Compliance">{pct(slot.compliancePct)}</td>
                        <td data-label="Semantic">{slot.semanticScorePct === null ? "-" : pct(slot.semanticScorePct)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6}>No slot detail available for this legacy report row.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </details>

            {riskRows.length ? (
              <details>
                <summary>At-Risk Members</summary>
                <div className="table-wrap mobile-cards" style={{ marginTop: 8 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskRows.map((row) => (
                        <tr key={`${report.id}-${row.name}`}>
                          <td data-label="Member">{row.name}</td>
                          <td data-label="Score">{row.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </article>
        );
      })}

      {!filteredReports.length ? <p className="muted">No reports found for current filters.</p> : null}

      {profile ? (
        <div className="profile-overlay" role="dialog" aria-modal="true" onClick={() => setProfileName(null)}>
          <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-head">
              <div className="inline" style={{ gap: 12 }}>
                <Avatar name={profile.name} />
                <div className="grid" style={{ gap: 2 }}>
                  <strong style={{ fontSize: 18 }}>{profile.name}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {profile.days} {profile.days === 1 ? "day" : "days"} of field reports
                  </span>
                </div>
              </div>
              <button className="ghost" type="button" onClick={() => setProfileName(null)}>Close</button>
            </div>

            {profile.days ? (
              <>
                <Badges stats={profile.badgeStats} />
                <div className="report-stats" style={{ marginTop: 4 }}>
                  <div className="report-stat"><span>Avg Performance</span><strong>{profile.avgScore}%</strong></div>
                  <div className="report-stat"><span>Avg Consistency</span><strong>{profile.avgConsistency}%</strong></div>
                  <div className="report-stat"><span>Field Presence</span><strong>{profile.avgFieldPresence}%</strong></div>
                  <div className="report-stat"><span>Customers Reached</span><strong>{profile.totalCustomers}</strong></div>
                  <div className="report-stat"><span>New Pipeline</span><strong>{profile.totalPipeline}</strong></div>
                </div>

                <div className="grid" style={{ gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Performance trend (last {Math.min(14, profile.points.length)} days)
                  </span>
                  <Sparkline points={profile.points} />
                </div>

                <div className="grid" style={{ gap: 8 }}>
                  {[...profile.points].reverse().slice(0, 10).map((point) => (
                    <div className="profile-day" key={point.id}>
                      <div className="inline" style={{ justifyContent: "space-between" }}>
                        <strong>{formatDate(point.date)}</strong>
                        <span className="pill">{point.score}%</span>
                      </div>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {point.customers}/{point.visitTarget} customers · {point.pipeline} pipeline · {point.consistency}% consistency
                      </span>
                      {point.highlight ? <span className="muted" style={{ fontSize: 12 }}>🌟 {point.highlight}</span> : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                No field data for {profile.name} yet. Daily field metrics appear here once this rep starts replying to scheduled
                check-ins.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
