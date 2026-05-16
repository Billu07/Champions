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
        label: "Reply Fragments",
        value: String(asNumber(summary.totalReplyFragments)),
      },
    ];
  }

  const membersTracked = asNumber(kpi.membersTracked || metrics.members || metrics.totalMembers);
  const avgWeighted = asNumber(kpi.averageWeightedPerformancePct || metrics.replyRate);
  const criticalPerfect = asNumber(kpi.criticalPerfectCount || kpi.criticalCompliancePct || 0);
  const fragments = asNumber(kpi.totalReplyFragments || metrics.teamReplies || metrics.totalReplies || 0);

  return [
    { label: "Members Tracked", value: String(membersTracked) },
    {
      label: report.kind === "team_daily" ? "Critical Perfect Members" : "Critical Perfect",
      value: report.kind === "team_daily" ? String(criticalPerfect) : pct(asNumber(kpi.criticalPerfectPct)),
    },
    { label: "Avg Weighted Performance", value: pct(avgWeighted) },
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
  }));
}

function extractRiskRows(report: Report): Array<{ name: string; score: string }> {
  const metrics = asRecord(report.metrics);
  const atRisk = asArray(metrics.atRiskMembers);
  return atRisk.slice(0, 8).map((row) => ({
    name: asString(row.employeeName) || asString(row.employeeId),
    score: `${pct(asNumber(row.weightedPerformancePct))} | Critical ${asNumber(row.criticalSlotsReplied)}/${asNumber(row.criticalSlotsExpected || 2)}`,
  }));
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function reportExportHtml(reports: Report[], brandName: string, brandTagline: string): string {
  const sections = reports
    .map((report) => {
      const kpis = summaryRowsForReport(report)
        .map((row) => `<li><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</li>`)
        .join("");

      const slots = extractSlotRows(report)
        .map(
          (slot) =>
            `<tr><td>${escapeHtml(slot.label)}${slot.critical ? " (critical)" : ""}</td><td>${slot.expected}</td><td>${slot.replied}</td><td>${slot.missing}</td><td>${slot.compliancePct.toFixed(2)}%</td></tr>`,
        )
        .join("");

      return `
        <section class="report-card">
          <h2>${escapeHtml(report.title)}</h2>
          <p class="meta">${escapeHtml(KIND_LABEL[report.kind])} | ${escapeHtml(report.report_date)} | Model: ${escapeHtml(report.model_name)}</p>
          <p>${escapeHtml(report.narrative)}</p>
          <ul>${kpis}</ul>
          <table>
            <thead>
              <tr><th>Slot</th><th>Expected</th><th>Replied</th><th>Missing</th><th>Compliance</th></tr>
            </thead>
            <tbody>${slots}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `
    <html>
      <head>
        <title>${escapeHtml(brandName)} - Report Export</title>
        <style>
          @page { size: A4; margin: 14mm; }
          body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; line-height: 1.4; }
          header { border-bottom: 2px solid #0f4c81; margin-bottom: 18px; padding-bottom: 10px; }
          h1 { margin: 0; font-size: 24px; }
          h2 { margin: 0 0 6px; font-size: 17px; color: #0f365e; }
          .tagline { margin: 4px 0 0; color: #475569; }
          .meta { color: #475569; font-size: 12px; margin: 6px 0 10px; }
          .report-card { break-inside: avoid; border: 1px solid #d5e0ea; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
          th, td { border: 1px solid #d8e2ed; padding: 6px; text-align: left; }
          th { background: #eff6fc; }
          ul { margin: 8px 0 0 18px; }
        </style>
      </head>
      <body>
        <header>
          <h1>${escapeHtml(brandName)} - Operations Reports</h1>
          <p class="tagline">${escapeHtml(brandTagline)}</p>
          <p class="meta">Generated at ${escapeHtml(new Date().toLocaleString())}</p>
        </header>
        ${sections}
      </body>
    </html>
  `;
}

function openPrintWindow(reports: Report[], brandName: string, brandTagline: string): void {
  const html = reportExportHtml(reports, brandName, brandTagline);
  const popup = window.open("", "_blank", "noopener,noreferrer,width=1100,height=920");
  if (!popup) return;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function ReportsBoard({ initialReports, brandName, brandTagline }: ReportsBoardProps) {
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [kindFilter, setKindFilter] = useState<ReportKindFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

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
    <section className="grid" style={{ gap: 14 }}>
      <article className="card grid" style={{ gap: 10 }}>
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
            <button className="ghost" onClick={() => openPrintWindow(filteredReports, brandName, brandTagline)}>
              Export Branded PDF
            </button>
          </div>
          <span className="muted">{status}</span>
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
              <span className="pill">{KIND_LABEL[report.kind]}</span>
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
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5}>No slot detail available for this legacy report row.</td>
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
