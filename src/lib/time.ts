import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { addDays, set } from "date-fns";
import { SLOT_DEFINITIONS } from "@/lib/constants";
import type { LegacySlotKey } from "@/lib/types";

export function dhakaDayName(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "EEEE");
}

export function dhakaDateISO(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export function slotByKey(slot: LegacySlotKey) {
  const found = SLOT_DEFINITIONS.find((item) => item.key === slot);
  if (!found) throw new Error(`Unknown slot: ${slot}`);
  return found;
}

export function slotForTimestamp(date: Date, timezone: string): LegacySlotKey {
  const zoned = toZonedTime(date, timezone);
  const minuteOfDay = zoned.getHours() * 60 + zoned.getMinutes();

  const boundaries = SLOT_DEFINITIONS.map((slot) => ({
    key: slot.key,
    minute: slot.startHour * 60 + slot.startMinute,
  }));

  if (minuteOfDay >= boundaries[3].minute) return "evening";
  if (minuteOfDay >= boundaries[2].minute) return "afternoon";
  if (minuteOfDay >= boundaries[1].minute) return "noon";
  return "morning";
}

export function slotWindow(date: Date, slot: LegacySlotKey, timezone: string): {
  startISO: string;
  endISO: string;
} {
  const zoned = toZonedTime(date, timezone);
  const current = slotByKey(slot);
  const nextIndex = SLOT_DEFINITIONS.findIndex((item) => item.key === slot) + 1;
  const next = SLOT_DEFINITIONS[nextIndex] ?? SLOT_DEFINITIONS[0];

  const startLocal = set(zoned, {
    hours: current.startHour,
    minutes: current.startMinute,
    seconds: 0,
    milliseconds: 0,
  });

  const endBase = set(zoned, {
    hours: next.startHour,
    minutes: next.startMinute,
    seconds: 0,
    milliseconds: 0,
  });

  const wraps = nextIndex >= SLOT_DEFINITIONS.length;
  const endLocal = wraps ? addDays(endBase, 1) : endBase;

  return {
    startISO: startLocal.toISOString(),
    endISO: endLocal.toISOString(),
  };
}

export function minuteOfDayForTimezone(date: Date, timezone: string): number {
  const zoned = toZonedTime(date, timezone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}
