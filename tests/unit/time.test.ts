import { describe, expect, it } from "vitest";
import { slotForTimestamp } from "@/lib/time";

describe("slotForTimestamp", () => {
  it("maps 8:15 Dhaka to morning", () => {
    const date = new Date("2026-05-12T02:15:00.000Z");
    expect(slotForTimestamp(date, "Asia/Dhaka")).toBe("morning");
  });

  it("maps 12:10 Dhaka to noon", () => {
    const date = new Date("2026-05-12T06:10:00.000Z");
    expect(slotForTimestamp(date, "Asia/Dhaka")).toBe("noon");
  });

  it("maps 15:05 Dhaka to afternoon", () => {
    const date = new Date("2026-05-12T09:05:00.000Z");
    expect(slotForTimestamp(date, "Asia/Dhaka")).toBe("afternoon");
  });

  it("maps 17:45 Dhaka to evening", () => {
    const date = new Date("2026-05-12T11:45:00.000Z");
    expect(slotForTimestamp(date, "Asia/Dhaka")).toBe("evening");
  });
});
