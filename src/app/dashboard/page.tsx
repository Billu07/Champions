import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { env } from "@/lib/config";
import { AdminNav } from "@/components/admin-nav";
import { dhakaDateISO } from "@/lib/time";
import { getOpsDashboardMetrics, listRecentBroadcastCampaigns, listReports } from "@/lib/repository";

export default async function DashboardPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  const trackingDate = dhakaDateISO(new Date(), env.NEXT_PUBLIC_APP_TIMEZONE);
  const [metrics, campaigns, reports] = await Promise.all([
    getOpsDashboardMetrics(trackingDate, {
      includeTestScheduler: env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER,
    }),
    listRecentBroadcastCampaigns(10),
    listReports({ limit: 8, kind: "all" }),
  ]);

  return (
    <main className="page">
      <AdminNav />
      <h1>Operations Dashboard</h1>
      <p>
        Daily operational health across scheduling, replies, broadcasts, and daily/weekly/monthly reporting.
      </p>

      <section className="kpi-grid dashboard-kpis" style={{ marginTop: 14 }}>
        <article className="card kpi-card">
          <p className="kpi-label">Active Members</p>
          <p className="kpi-value">{metrics.employees.active}</p>
          <p className="kpi-sub">Total roster: {metrics.employees.total}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Tracked Field Members</p>
          <p className="kpi-value">{metrics.employees.trackedActive}</p>
          <p className="kpi-sub">Tracking date: {metrics.trackingDate}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Reply Rate</p>
          <p className="kpi-value">{metrics.responses.replyRate}%</p>
          <p className="kpi-sub">
            Replied: {metrics.responses.repliedSlots} | Missing: {metrics.responses.missingSlots}
          </p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Broadcast (24h)</p>
          <p className="kpi-value">{metrics.broadcast24h.delivered}</p>
          <p className="kpi-sub">
            Delivered/Read, Failed: {metrics.broadcast24h.failed}
          </p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Reports Today</p>
          <p className="kpi-value">{metrics.reports.generatedToday}</p>
          <p className="kpi-sub">
            Total reply fragments: {metrics.responses.totalReplyFragments}
          </p>
        </article>
        {env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER ? (
          <article className="card kpi-card">
            <p className="kpi-label">Pending Test Schedules</p>
            <p className="kpi-value">{metrics.testScheduler.pendingJobs}</p>
            <p className="kpi-sub">Queue currently in running state</p>
          </article>
        ) : null}
      </section>

      <section className="grid dashboard-panels" style={{ gap: 12, marginTop: 16 }}>
        <article className="card dashboard-campaigns">
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>Recent Broadcasts</h2>
            <span className="muted">Last {campaigns.length}</span>
          </div>

          <div className="dash-list">
            {campaigns.length ? campaigns.map((item) => {
              const summary = (item as {
                delivery_summary: { accepted: number; sent: number; delivered: number; read: number; failed: number };
              }).delivery_summary;
              const reached = summary.delivered + summary.read;
              return (
                <details className="dash-item" key={item.id as string}>
                  <summary className="dash-item-summary">
                    <span className="dash-item-main">
                      <strong>{String(item.audience_type)}</strong>
                      <span className="muted">
                        {new Date(String(item.created_at)).toLocaleDateString()} · {String(item.recipient_count)} recipients
                      </span>
                    </span>
                    <span className="dash-item-tags">
                      <span className="pill pill-ok">✓ {reached}</span>
                      {summary.failed ? <span className="pill pill-bad">✗ {summary.failed}</span> : null}
                    </span>
                    <span className="dash-item-chevron" aria-hidden="true">▾</span>
                  </summary>
                  <div className="dash-item-body">
                    <div className="dash-kv"><span>Accepted</span><span>{summary.accepted}</span></div>
                    <div className="dash-kv"><span>Sent</span><span>{summary.sent}</span></div>
                    <div className="dash-kv"><span>Delivered</span><span>{summary.delivered}</span></div>
                    <div className="dash-kv"><span>Read</span><span>{summary.read}</span></div>
                    <div className="dash-kv"><span>Failed</span><span>{summary.failed}</span></div>
                    {item.final_message ? (
                      <p className="dash-msg muted">{String(item.final_message).slice(0, 160)}</p>
                    ) : null}
                  </div>
                </details>
              );
            }) : (
              <p className="muted">No campaigns yet.</p>
            )}
          </div>
        </article>

        <article className="card dashboard-reports">
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>Latest Reports</h2>
            <span className="muted">{reports.length} loaded</span>
          </div>
          <div className="dash-list">
            {reports.length ? reports.map((report) => (
              <details className="dash-item" key={report.id as string}>
                <summary className="dash-item-summary">
                  <span className="dash-item-main">
                    <strong>{String(report.title)}</strong>
                    <span className="muted">{String(report.report_date)}</span>
                  </span>
                  <span className="dash-item-tags">
                    <span className="pill">{String(report.kind)}</span>
                  </span>
                  <span className="dash-item-chevron" aria-hidden="true">▾</span>
                </summary>
                <div className="dash-item-body">
                  <p className="muted" style={{ margin: 0 }}>
                    {String(report.narrative).slice(0, 320)}
                    {String(report.narrative).length > 320 ? "…" : ""}
                  </p>
                </div>
              </details>
            )) : (
              <p className="muted">No reports yet.</p>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
