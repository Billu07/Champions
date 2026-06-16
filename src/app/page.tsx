import Link from "next/link";
import Image from "next/image";
import { isLoggedIn } from "@/lib/auth";
import { env } from "@/lib/config";

const cards = [
  {
    title: "Dashboard",
    text: "KPI overview of roster, reply health, report generation, and broadcast outcomes.",
  },
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
    text: "Individual daily, team daily, weekly, and monthly reports are generated and stored.",
  },
  {
    title: "CEO Broadcast",
    text: "Targeted sends by member, tags, or mention-detected recipients with confirmation.",
  },
];

export default async function HomePage() {
  const loggedIn = await isLoggedIn();

  const allCards = [
    ...cards,
    ...(env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER
      ? [
          {
            title: "Test Scheduler",
            text: "Frontend queue for scheduling slot-template test sends to selected users.",
          },
        ]
      : []),
  ];

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand-shell">
          <span className="brand-badge brand-logo-wrap" aria-hidden="true">
            <Image
              src="/brand/logo-c.png"
              alt="Champions Family"
              width={303}
              height={120}
              priority
              className="brand-logo"
            />
          </span>
        </div>

        <div className="inline" style={{ gap: 10 }}>
          {loggedIn ? (
            <nav className="nav">
              <Link href="/dashboard" className="nav-link">Dashboard</Link>
              <Link href="/employees" className="nav-link">Employees</Link>
              <Link href="/broadcasts" className="nav-link">Broadcasts</Link>
              <Link href="/conversations" className="nav-link">Conversations</Link>
              <Link href="/reports" className="nav-link">Reports</Link>
              {env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER ? <Link href="/test-scheduler" className="nav-link">Test Scheduler</Link> : null}
            </nav>
          ) : null}
          {/* Always-visible CTA — the public landing page has no hamburger, so the
              primary action must never live inside the collapsible .nav. */}
          <Link href={loggedIn ? "/dashboard" : "/login"} className="button nav-cta">
            {loggedIn ? "Open Dashboard" : "Login"}
          </Link>
        </div>
      </header>

      <h1>WhatsApp Operations Control Center</h1>
      <p>Code-first platform for scheduling, reply capture, analytics, and leadership broadcasts.</p>

      <section className="grid cards" style={{ marginTop: 16 }}>
        {allCards.map((card) => (
          <article className="card" key={card.title}>
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
