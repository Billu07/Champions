"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/test-scheduler", label: "Test Scheduler" },
  { href: "/broadcasts", label: "Broadcasts" },
  { href: "/reports", label: "Reports" },
] as const;

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
