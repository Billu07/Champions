import { cookies } from "next/headers";
import { env } from "@/lib/config";

const AUTH_COOKIE = "cf_ops_admin";

export async function isLoggedIn(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE)?.value === "1";
}

export async function requireDashboardSession(): Promise<void> {
  if (!(await isLoggedIn())) {
    throw new Error("Unauthorized");
  }
}

export async function createSession(password: string): Promise<boolean> {
  if (!env.CEO_PANEL_PASSWORD || password !== env.CEO_PANEL_PASSWORD) {
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: AUTH_COOKIE,
    value: "1",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return true;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
}

export async function requestHasAdminSession(request: Request): Promise<boolean> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader.includes(`${AUTH_COOKIE}=1`);
}

export function assertCronSecret(request: Request): void {
  const incoming = request.headers.get("x-cron-secret");
  if (!incoming || incoming !== env.CRON_JOB_SECRET) {
    throw new Error("Unauthorized cron call");
  }
}
