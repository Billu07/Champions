import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { ScheduleLabConsole } from "@/components/schedule-lab-console";
import { isLoggedIn } from "@/lib/auth";
import { listScheduleLabEntries } from "@/lib/repository";

export default async function ScheduleLabPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  let initialSchedules: Awaited<ReturnType<typeof listScheduleLabEntries>> = [];
  let initialError: string | null = null;

  try {
    initialSchedules = await listScheduleLabEntries();
  } catch (error) {
    initialError = (error as Error).message || "Failed to load schedule lab.";
  }

  return (
    <main className="page">
      <AdminNav />
      <h1>Schedule Lab</h1>
      <p>Create and manage scheduled messages.</p>
      <ScheduleLabConsole initialSchedules={initialSchedules} initialError={initialError} />
    </main>
  );
}
