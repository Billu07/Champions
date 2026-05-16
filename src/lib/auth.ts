import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/config";

const AUTH_COOKIE = "cf_ops_admin";
const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function resolveSessionSecret(): string {
  return env.ADMIN_SESSION_SECRET ?? env.CRON_JOB_SECRET;
}

function signPayload(payload: string): string {
  return createHmac("sha256", resolveSessionSecret()).update(payload).digest("base64url");
}

function buildSessionToken(username: string): string {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `${SESSION_VERSION}.${username}.${expiresAt}`;
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [version, username, expiresAtRaw, signature] = parts;
  if (version !== SESSION_VERSION) return false;
  if (!safeEqual(username, env.ADMIN_LOGIN_USERNAME)) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const payload = `${version}.${username}.${expiresAtRaw}`;
  const expectedSignature = signPayload(payload);
  return safeEqual(signature, expectedSignature);
}

function verifyAdminPassword(password: string): boolean {
  if (env.ADMIN_PASSWORD_HASH) {
    const salt = env.ADMIN_PASSWORD_SALT ?? env.ADMIN_LOGIN_USERNAME;
    const hashed = createHash("sha256")
      .update(`${salt}:${password}`)
      .digest("hex");
    return safeEqual(hashed.toLowerCase(), env.ADMIN_PASSWORD_HASH.toLowerCase());
  }

  const plainPassword = env.ADMIN_LOGIN_PASSWORD ?? env.CEO_PANEL_PASSWORD ?? "";
  if (!plainPassword) return false;
  return safeEqual(password, plainPassword);
}

function getCookieValueFromHeader(cookieHeader: string, name: string): string | undefined {
  const pairs = cookieHeader.split(";").map((item) => item.trim()).filter(Boolean);
  for (const pair of pairs) {
    const [cookieName, ...rest] = pair.split("=");
    if (cookieName !== name) continue;
    return rest.join("=");
  }
  return undefined;
}

export async function isLoggedIn(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function requireDashboardSession(): Promise<void> {
  if (!(await isLoggedIn())) {
    throw new Error("Unauthorized");
  }
}

export async function createSession(username: string, password: string): Promise<boolean> {
  if (!safeEqual(username, env.ADMIN_LOGIN_USERNAME) || !verifyAdminPassword(password)) {
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: AUTH_COOKIE,
    value: buildSessionToken(username),
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return true;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
}

export async function requestHasAdminSession(request: Request): Promise<boolean> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = getCookieValueFromHeader(cookieHeader, AUTH_COOKIE);
  return verifySessionToken(token);
}

export function assertCronSecret(request: Request): void {
  const incoming = request.headers.get("x-cron-secret") ?? "";
  if (!incoming || !safeEqual(incoming, env.CRON_JOB_SECRET)) {
    throw new Error("Unauthorized cron call");
  }
}
