import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { listEmployees, listTags } from "@/lib/repository";
import { AdminNav } from "@/components/admin-nav";
import { EmployeeManager } from "@/components/employee-manager";

export default async function EmployeesPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  const [employees, tags] = await Promise.all([listEmployees(), listTags()]);

  return (
    <main className="page">
      <AdminNav />
      <h1>Employees & Tags</h1>
      <p>Manage roster, tracking eligibility, and routing tags (Sales, HO, Drivers).</p>
      <EmployeeManager initialEmployees={employees} initialTags={tags} />
    </main>
  );
}
