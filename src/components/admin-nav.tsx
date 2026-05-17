"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";

const testSchedulerEnabled = process.env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER === "true";

type NavLink = {
  href: Route;
  label: string;
};

const links: NavLink[] = [
  { href: "/dashboard" as Route, label: "Dashboard" },
  { href: "/employees" as Route, label: "Employees" },
  { href: "/broadcasts" as Route, label: "Broadcasts" },
  { href: "/conversations" as Route, label: "Conversations" },
  { href: "/reports" as Route, label: "Reports" },
];

if (testSchedulerEnabled) {
  links.push({ href: "/test-scheduler" as Route, label: "Test Scheduler" });
}

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    for (const link of links) {
      router.prefetch(link.href);
    }
  }, [router]);

  return (
    <header className="topbar">
      <div className="brand">Champions Family Ops</div>
      <div className="inline">
        <nav className="nav">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch
              className={pathname.startsWith(link.href) ? "active" : ""}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <form method="post" action="/api/auth/logout">
          <button className="ghost" type="submit">
            Logout
          </button>
        </form>
      </div>
    </header>
  );
}
