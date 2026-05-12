import type { SlotDefinition } from "@/lib/types";

export const SLOT_DEFINITIONS: SlotDefinition[] = [
  { key: "morning", label: "Morning", startHour: 8, startMinute: 0 },
  { key: "noon", label: "Noon", startHour: 12, startMinute: 0 },
  { key: "afternoon", label: "Afternoon", startHour: 15, startMinute: 0 },
  { key: "evening", label: "Evening", startHour: 17, startMinute: 30 },
];

export const TRACKING_TAG_KEY = "sales_field";

export const WORKING_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
