"use client";

import { useMemo, useState } from "react";

type Report = {
  id: string;
  kind: "individual_daily" | "team_daily" | "team_weekly";
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
};

type ReportKindFilter = Report["kind"] | "all";

function resolveEmployeeName(report: Report): string {
  if (!report.employees) return "";
  if (Array.isArray(report.employees)) {
    return report.employees[0]?.full_name ?? "";
  }
  return report.employees.full_name ?? "";
}

function printReportsAsPdf(reports: Report[]): void {
  const printable = reports
    .map((report) => {
      const metrics = JSON.stringify(report.metrics, null, 2);
      const employee = resolveEmployeeName(report);
      return `
        <article>
          <h2>${report.title}</h2>
          <p><strong>Kind:</strong> ${report.kind} | <strong>Date:</strong> ${report.report_date} | <strong>Model:</strong> ${report.model_name}${employee ? ` | <strong>Employee:</strong> ${employee}` : ""}</p>
          <p>${report.narrative.replace(/\n/g, "<br />")}</p>
          <pre>${metrics}</pre>
        </article>
      `;
    })
    .join("<hr />");

  const html = `
    <html>
      <head>
        <title>Champions Reports Export</title>
        <style>
          body { font-family: "Segoe UI", Arial, sans-serif; padding: 24px; line-height: 1.4; }
          h1 { margin: 0 0 12px; }
          h2 { margin: 0 0 8px; font-size: 18px; }
          p { margin: 8px 0; }
          pre { background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; }
          article { margin-bottom: 20px; }
          hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h1>Champions Family Reports</h1>
        <p>Generated at: ${new Date().toLocaleString()}</p>
        ${printable}
      </body>
    </html>
  `;

  const popup = window.open("", "_blank", "noopener,noreferrer,width=1000,height=900");
  if (!popup) return;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function ReportsBoard({ initialReports }: ReportsBoardProps) {
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [kindFilter, setKindFilter] = useState<ReportKindFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  async function loadReports() {
    setStatus("Loading reports...");
    const params = new URLSearchParams();
    params.set("limit", "180");
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
    const individual = filteredReports.filter((item) => item.kind === "individual_daily").length;
    const teamDaily = filteredReports.filter((item) => item.kind === "team_daily").length;
    const teamWeekly = filteredReports.filter((item) => item.kind === "team_weekly").length;

    return {
      total: filteredReports.length,
      individual,
      teamDaily,
      teamWeekly,
    };
  }, [filteredReports]);

  return (
    <section className="grid" style={{ gap: 14 }}>
      <article className="card grid" style={{ gap: 10 }}>
        <div className="row">
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Type</span>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as ReportKindFilter)}>
              <option value="all">All</option>
              <option value="individual_daily">Individual Daily</option>
              <option value="team_daily">Team Daily</option>
              <option value="team_weekly">Team Weekly</option>
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
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title / narrative / employee"
            />
          </label>
        </div>

        <div className="inline" style={{ justifyContent: "space-between" }}>
          <div className="inline">
            <button onClick={() => void loadReports()}>Apply Filters</button>
            <button className="ghost" onClick={() => printReportsAsPdf(filteredReports)}>
              Export PDF
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
      </div>

      {filteredReports.map((report) => {
        const employee = resolveEmployeeName(report);

        return (
          <article className="card" key={report.id}>
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <h2>{report.title}</h2>
              <span className="pill">{report.kind}</span>
            </div>
            <p>
              Date: {report.report_date} | Model: {report.model_name}
              {employee ? ` | Employee: ${employee}` : ""}
            </p>
            <p>{report.narrative}</p>
            <details>
              <summary>Metrics JSON</summary>
              <pre>{JSON.stringify(report.metrics, null, 2)}</pre>
            </details>
          </article>
        );
      })}

      {!filteredReports.length ? <p className="muted">No reports found for current filters.</p> : null}
    </section>
  );
}
