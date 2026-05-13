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
      <h1>People Directory</h1>
      <p>Manage members, tags, tracking eligibility, and routing metadata.</p>
      <EmployeeManager initialEmployees={employees} initialTags={tags} />
    </main>
  );
}
