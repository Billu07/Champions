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

      <section className="kpi-grid" style={{ marginTop: 14 }}>
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

      <section className="grid" style={{ gap: 12, marginTop: 16 }}>
        <article className="card">
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>Recent Broadcast Campaigns</h2>
            <span className="muted">Last {campaigns.length}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Audience</th>
                  <th>Recipients</th>
                  <th>Accepted</th>
                  <th>Sent</th>
                  <th>Delivered</th>
                  <th>Read</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length ? campaigns.map((item) => (
                  <tr key={item.id as string}>
                    <td>{new Date(String(item.created_at)).toLocaleString()}</td>
                    <td>{String(item.audience_type)}</td>
                    <td>{String(item.recipient_count)}</td>
                    <td>{String((item as { delivery_summary: { accepted: number } }).delivery_summary.accepted)}</td>
                    <td>{String((item as { delivery_summary: { sent: number } }).delivery_summary.sent)}</td>
                    <td>{String((item as { delivery_summary: { delivered: number } }).delivery_summary.delivered)}</td>
                    <td>{String((item as { delivery_summary: { read: number } }).delivery_summary.read)}</td>
                    <td>{String((item as { delivery_summary: { failed: number } }).delivery_summary.failed)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8}>No campaigns yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>Latest Reports</h2>
            <span className="muted">{reports.length} loaded</span>
          </div>
          <div className="grid" style={{ gap: 10 }}>
            {reports.map((report) => (
              <div className="panel" key={report.id as string}>
                <div className="inline" style={{ justifyContent: "space-between" }}>
                  <strong>{String(report.title)}</strong>
                  <span className="pill">{String(report.kind)}</span>
                </div>
                <p className="muted">
                  {String(report.report_date)} | Model: {String(report.model_name)}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
