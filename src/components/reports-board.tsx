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
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportingReportId, setExportingReportId] = useState<string | null>(null);

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

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;

    return reports.filter((report) => {
      const employee = resolveEmployeeName(report);
      return (
        report.title.toLowerCase().includes(q) ||
        report.narrative.toLowerCase().includes(q) ||
        report.kind.toLowerCase().includes(q) ||
        report.report_date.includes(q) ||
        employee.toLowerCase().includes(q)
      );
    });
  }, [reports, search]);

  const summary = useMemo(() => {
    return {
      total: filteredReports.length,
      individual: filteredReports.filter((item) => item.kind === "individual_daily").length,
      teamDaily: filteredReports.filter((item) => item.kind === "team_daily").length,
      teamWeekly: filteredReports.filter((item) => item.kind === "team_weekly").length,
      teamMonthly: filteredReports.filter((item) => item.kind === "team_monthly").length,
    };
  }, [filteredReports]);

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

        <div className="inline" style={{ justifyContent: "space-between" }}>
          <div className="inline">
            <button onClick={() => void loadReports()}>Apply Filters</button>
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

        return (
          <article className="card" key={report.id}>
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <h2>{report.title}</h2>
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
            <p>
              Date: {formatDate(report.report_date)} | Generated: {new Date(report.created_at).toLocaleString()} | Model: {report.model_name}
              {employee ? ` | Employee: ${employee}` : ""}
            </p>

            <div className="inline">
              {summaryRows.map((row) => (
                <span className="pill" key={`${report.id}-${row.label}`}>{row.label}: {row.value}</span>
              ))}
            </div>

            <p>{report.narrative}</p>

            <details>
              <summary>Slot Compliance Details</summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
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
                        <td>{slot.label}{slot.critical ? " (critical)" : ""}</td>
                        <td>{slot.expected}</td>
                        <td>{slot.replied}</td>
                        <td>{slot.missing}</td>
                        <td>{pct(slot.compliancePct)}</td>
                        <td>{slot.semanticScorePct === null ? "-" : pct(slot.semanticScorePct)}</td>
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
                <div className="table-wrap" style={{ marginTop: 8 }}>
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
                          <td>{row.name}</td>
                          <td>{row.score}</td>
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
    </section>
  );
}
