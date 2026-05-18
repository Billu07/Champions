"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";

const testSchedulerEnabled = process.env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER === "true";

type IconName =
  | "dashboard"
  | "employees"
  | "broadcasts"
  | "conversations"
  | "reports"
  | "calendar"
  | "logout";

type NavLink = {
  href: Route;
  label: string;
  icon: IconName;
};

const links: NavLink[] = [
  { href: "/dashboard" as Route, label: "Dashboard", icon: "dashboard" },
  { href: "/employees" as Route, label: "Employees", icon: "employees" },
  { href: "/broadcasts" as Route, label: "Broadcasts", icon: "broadcasts" },
  { href: "/conversations" as Route, label: "Conversations", icon: "conversations" },
  { href: "/reports" as Route, label: "Reports", icon: "reports" },
];

if (testSchedulerEnabled) {
  links.push({ href: "/test-scheduler" as Route, label: "Test Scheduler", icon: "calendar" });
}

function isActivePath(pathname: string, href: Route): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {name === "dashboard" ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1.4" />
          <rect x="14" y="3" width="7" height="7" rx="1.4" />
          <rect x="3" y="14" width="7" height="7" rx="1.4" />
          <rect x="14" y="14" width="7" height="7" rx="1.4" />
        </>
      ) : null}

      {name === "employees" ? (
        <>
          <path d="M16.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M7.5 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M2.5 21c0-3 2.4-5 5-5s5 2 5 5" />
          <path d="M11.5 21c0-2.7 2.1-4.6 4.5-4.6S20.5 18.3 20.5 21" />
        </>
      ) : null}

      {name === "broadcasts" ? (
        <>
          <path d="M3.5 11.5v1a2.5 2.5 0 0 0 2.5 2.5h2.5l5.8 3V6L8.5 9H6a2.5 2.5 0 0 0-2.5 2.5Z" />
          <path d="M17 8.5c1.5 1.2 2.3 2.2 2.3 3.5s-.8 2.3-2.3 3.5" />
        </>
      ) : null}

      {name === "conversations" ? (
        <>
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.3-4-.9L3 20.5l1.4-5a8.5 8.5 0 1 1 16.6-4Z" />
        </>
      ) : null}

      {name === "reports" ? (
        <>
          <path d="M4 20h16" />
          <path d="M7 18V9" />
          <path d="M12 18V5" />
          <path d="M17 18v-6" />
        </>
      ) : null}

      {name === "calendar" ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M3 10h18" />
        </>
      ) : null}

      {name === "logout" ? (
        <>
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
          <path d="m14 16 4-4-4-4" />
          <path d="M18 12H9" />
        </>
      ) : null}
    </svg>
  );
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
      <div className="brand brand-shell" aria-label="Champions Family Ops">
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

      <div className="topbar-right">
        <nav className="nav" aria-label="Primary">
          {links.map((link) => {
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                prefetch
                className={active ? "nav-link active" : "nav-link"}
              >
                <NavIcon name={link.icon} className="nav-link-icon" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <form method="post" action="/api/auth/logout" className="logout-form">
          <button className="ghost logout-btn" type="submit">
            <NavIcon name="logout" className="nav-link-icon" />
            <span>Logout</span>
          </button>
        </form>
      </div>
    </header>
  );
}
