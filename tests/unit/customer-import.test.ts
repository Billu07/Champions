import { describe, expect, it } from "vitest";
import { buildCustomerImportCsvTemplate, parseCustomerImportCsv } from "@/lib/customer-import";

describe("customer import CSV", () => {
  it("parses valid rows with header aliases", () => {
    const csv = [
      "name,phone,segment,location,remarks",
      "Kazi Tuhin,01712345678,Retail,Dhaka,Priority account",
    ].join("\n");

    const parsed = parseCustomerImportCsv(csv);
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fullName).toBe("Kazi Tuhin");
    expect(parsed.rows[0]?.whatsappE164).toBe("+8801712345678");
    expect(parsed.rows[0]?.customerSegment).toBe("Retail");
  });

  it("flags invalid phone format", () => {
    const csv = [
      "full_name,whatsapp_number,customer_segment,area,notes",
      "Invalid User,+8802999999999,Retail,Dhaka,Invalid mobile prefix",
    ].join("\n");

    const parsed = parseCustomerImportCsv(csv);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues.some((issue) => issue.field === "whatsapp_number")).toBe(true);
  });

  it("flags duplicate numbers in the same file", () => {
    const csv = [
      "full_name,whatsapp_number,customer_segment,area,notes",
      "Customer One,+8801712345678,Retail,Dhaka,First row",
      "Customer Two,01712345678,Retail,Dhaka,Second row duplicate",
    ].join("\n");

    const parsed = parseCustomerImportCsv(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.issues.some((issue) => issue.message.includes("Duplicate number in file"))).toBe(true);
  });

  it("builds a template with the required 5 fields", () => {
    const template = buildCustomerImportCsvTemplate();
    const [header] = template.split("\n");
    expect(header).toBe("full_name,whatsapp_number,customer_segment,area,notes");
  });
});
