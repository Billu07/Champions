import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { AdminNav } from "@/components/admin-nav";
import { ConversationsBoard } from "@/components/conversations-board";
import { listConversationMessageEvents, listEmployees } from "@/lib/repository";

export default async function ConversationsPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  const [employees, events] = await Promise.all([
    listEmployees(),
    listConversationMessageEvents(900),
  ]);

  return (
    <main className="page">
      <AdminNav />
      <h1>Conversations</h1>
      <p>
        Unified WhatsApp conversation intelligence across scheduled prompts, CEO broadcasts, and inbound replies.
        Scheduled report merges are isolated from broadcast/general conversations.
      </p>

      <ConversationsBoard
        initialEmployees={employees}
        initialEvents={events}
      />
    </main>
  );
}
