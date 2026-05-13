import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { listEmployees, listTags } from "@/lib/repository";
import { AdminNav } from "@/components/admin-nav";
import { BroadcastConsole } from "@/components/broadcast-console";

export default async function BroadcastsPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  const [employees, tags] = await Promise.all([listEmployees(), listTags()]);

  return (
    <main className="page">
      <AdminNav />
      <h1>Broadcast Center</h1>
      <p>
        Compose one message, auto-route by team or individual names, review each route, then send
        through approved WhatsApp template.
      </p>
      <BroadcastConsole
        initialEmployees={employees.filter((employee) => employee.is_active)}
        initialTags={tags}
      />
    </main>
  );
}
