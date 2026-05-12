import { env } from "@/lib/config";
import { normalizeBangladeshPhone } from "@/lib/phone";

const allowlist = new Set(
  env.WHATSAPP_TEST_ALLOWLIST_E164.split(",")
    .map((item) => normalizeBangladeshPhone(item.trim()))
    .filter(Boolean),
);

export function isWhatsAppTestAllowlistEnabled(): boolean {
  return allowlist.size > 0;
}

export function isWhatsAppRecipientAllowed(toE164: string): boolean {
  if (allowlist.size === 0) return true;
  return allowlist.has(normalizeBangladeshPhone(toE164));
}

export function filterAllowedEmployees<T extends { whatsapp_e164: string }>(employees: T[]): T[] {
  if (allowlist.size === 0) return employees;
  return employees.filter((employee) => isWhatsAppRecipientAllowed(employee.whatsapp_e164));
}
