import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { listReports } from "@/lib/repository";
import { AdminNav } from "@/components/admin-nav";
import { ReportsBoard } from "@/components/reports-board";

export default async function ReportsPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  const reports = await listReports(80);

  return (
    <main className="page">
      <AdminNav />
      <h1>Reports</h1>
      <p>Daily individual reports, team daily summaries, and weekly leadership briefs.</p>
      <ReportsBoard initialReports={reports} />
    </main>
  );
}
