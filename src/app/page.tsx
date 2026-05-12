import Link from "next/link";
import { isLoggedIn } from "@/lib/auth";

const cards = [
  {
    title: "Scheduled Tracking",
    text: "Daily 8:00, 12:00, 15:00, 17:30 Asia/Dhaka prompts to tracked sales members.",
  },
  {
    title: "Reply Attribution",
    text: "Replies are window-attributed and merged into canonical slot responses.",
  },
  {
    title: "AI Reporting",
    text: "Individual daily, team daily, and weekly reports are generated and stored.",
  },
  {
    title: "CEO Broadcast",
    text: "Targeted sends by member, tags, or mention-detected recipients with confirmation.",
  },
  {
    title: "Test Scheduler",
    text: "Frontend queue for scheduling slot-template test sends to selected users.",
  },
];

export default async function HomePage() {
  const loggedIn = await isLoggedIn();

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">Champions Family Ops</div>
        <nav className="nav">
          {loggedIn ? (
            <>
              <Link href="/employees">Employees</Link>
              <Link href="/test-scheduler">Test Scheduler</Link>
              <Link href="/broadcasts">Broadcasts</Link>
              <Link href="/reports">Reports</Link>
            </>
          ) : (
            <Link href="/login">Login</Link>
          )}
        </nav>
      </header>

      <h1>WhatsApp Operations Control Center</h1>
      <p>
        Code-first platform for scheduling, reply capture, analytics, and leadership broadcasts.
      </p>

      <section className="grid cards" style={{ marginTop: 16 }}>
        {cards.map((card) => (
          <article className="card" key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
