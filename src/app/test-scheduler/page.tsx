import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { env } from "@/lib/config";
import { AdminNav } from "@/components/admin-nav";
import { TestSchedulerConsole } from "@/components/test-scheduler-console";
import { listEmployees } from "@/lib/repository";
import { listTestSchedules } from "@/lib/test-scheduler";
import { isWhatsAppRecipientAllowed } from "@/lib/whatsapp-test-allowlist";

export default async function TestSchedulerPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  const [employees, schedules] = await Promise.all([listEmployees(), listTestSchedules()]);

  return (
    <main className="page">
      <AdminNav />
      <h1>Test Scheduler</h1>
      <p>Schedule slot-template sends to selected test users from frontend.</p>
      <TestSchedulerConsole
        timezone={env.NEXT_PUBLIC_APP_TIMEZONE}
        initialEmployees={employees.map((employee) => ({
          id: employee.id,
          full_name: employee.full_name,
          whatsapp_e164: employee.whatsapp_e164,
          designation: employee.designation,
          department: employee.department,
          is_active: employee.is_active,
          tracking_enabled: employee.tracking_enabled,
          is_test_allowed: isWhatsAppRecipientAllowed(employee.whatsapp_e164),
        }))}
        initialSchedules={schedules}
      />
    </main>
  );
}
