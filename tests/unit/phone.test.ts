import { describe, expect, it } from "vitest";
import { normalizeBangladeshPhone } from "@/lib/phone";

describe("normalizeBangladeshPhone", () => {
  it("normalizes local 01 format", () => {
    expect(normalizeBangladeshPhone("01997 343 434")).toBe("+8801997343434");
  });

  it("keeps 880 prefixed input", () => {
    expect(normalizeBangladeshPhone("8801997343434")).toBe("+8801997343434");
  });

  it("normalizes bare 1XXXXXXXXX", () => {
    expect(normalizeBangladeshPhone("1997343434")).toBe("+8801997343434");
  });
});
