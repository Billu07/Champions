import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { env } from "@/lib/config";
import { listReports } from "@/lib/repository";
import { AdminNav } from "@/components/admin-nav";
import { ReportsBoard } from "@/components/reports-board";

export default async function ReportsPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  const reports = await listReports(45);

  return (
    <main className="page">
      <AdminNav />
      <h1>Reports</h1>
      <p>Filter, inspect, and export structured daily, weekly, and monthly intelligence reports.</p>
      <ReportsBoard
        initialReports={reports}
        brandName={env.REPORT_BRAND_NAME}
        brandTagline={env.REPORT_BRAND_TAGLINE}
      />
    </main>
  );
}
