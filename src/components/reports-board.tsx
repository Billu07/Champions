"use client";

import { useState } from "react";

type Report = {
  id: string;
  kind: string;
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

export function ReportsBoard({ initialReports }: ReportsBoardProps) {
  const [reports] = useState<Report[]>(initialReports);

  function employeeName(report: Report): string {
    if (!report.employees) return "";
    if (Array.isArray(report.employees)) {
      return report.employees[0]?.full_name ?? "";
    }
    return report.employees.full_name ?? "";
  }

  return (
    <section className="grid" style={{ gap: 14 }}>
      {reports.map((report) => (
        <article className="card" key={report.id}>
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>{report.title}</h2>
            <span className="pill">{report.kind}</span>
          </div>
          <p>
            Date: {report.report_date} | Model: {report.model_name}
            {employeeName(report) ? ` | Employee: ${employeeName(report)}` : ""}
          </p>
          <p>{report.narrative}</p>
          <pre>{JSON.stringify(report.metrics, null, 2)}</pre>
        </article>
      ))}

      {!reports.length ? <p className="muted">No reports yet.</p> : null}
    </section>
  );
}
