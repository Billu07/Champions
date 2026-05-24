import { normalizeBangladeshPhone } from "@/lib/phone";

export const CUSTOMER_IMPORT_FIELDS = [
  { key: "full_name", label: "Full Name", required: true },
  { key: "whatsapp_number", label: "WhatsApp Number", required: true },
  { key: "customer_segment", label: "Customer Segment", required: false },
  { key: "area", label: "Area", required: false },
  { key: "notes", label: "Notes", required: false },
] as const;

type CustomerImportField = (typeof CUSTOMER_IMPORT_FIELDS)[number]["key"];

type HeaderMap = Record<CustomerImportField, number>;

const FIELD_ALIASES: Record<CustomerImportField, string[]> = {
  full_name: ["full_name", "name", "customer_name", "client_name"],
  whatsapp_number: ["whatsapp_number", "phone", "phone_number", "mobile", "whatsapp", "number"],
  customer_segment: ["customer_segment", "segment", "category", "type", "department"],
  area: ["area", "location", "zone", "region", "branch"],
  notes: ["notes", "note", "remark", "remarks", "comment"],
};

const STRICT_BD_WHATSAPP = /^\+8801\d{9}$/;

export type ParsedCustomerImportRow = {
  rowNumber: number;
  fullName: string;
  whatsappNumberRaw: string;
  whatsappE164: string;
  customerSegment: string | null;
  area: string | null;
  notes: string | null;
};

export type CustomerImportIssue = {
  rowNumber: number;
  field: CustomerImportField | "row";
  message: string;
  value?: string;
};

export type CustomerImportParseResult = {
  rows: ParsedCustomerImportRow[];
  issues: CustomerImportIssue[];
  totalDataRows: number;
};

function normalizeHeader(input: string): string {
  return input
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  out.push(value);
  return out.map((item) => item.trim());
}

function buildHeaderMap(headers: string[]): HeaderMap {
  const normalizedHeaderMap = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized || normalizedHeaderMap.has(normalized)) return;
    normalizedHeaderMap.set(normalized, index);
  });

  const output = {
    full_name: -1,
    whatsapp_number: -1,
    customer_segment: -1,
    area: -1,
    notes: -1,
  } as HeaderMap;

  for (const field of CUSTOMER_IMPORT_FIELDS) {
    for (const alias of FIELD_ALIASES[field.key]) {
      const index = normalizedHeaderMap.get(alias);
      if (typeof index === "number") {
        output[field.key] = index;
        break;
      }
    }
  }

  return output;
}

function valueAt(values: string[], index: number): string {
  if (index < 0) return "";
  return String(values[index] ?? "").trim();
}

export function parseCustomerImportCsv(csvText: string): CustomerImportParseResult {
  const lines = csvText.replace(/\r\n?/g, "\n").split("\n");
  const issues: CustomerImportIssue[] = [];

  if (lines.length === 0 || !lines[0]?.trim()) {
    return {
      rows: [],
      issues: [{ rowNumber: 1, field: "row", message: "CSV header row is missing." }],
      totalDataRows: 0,
    };
  }

  const headers = parseCsvLine(lines[0]);
  const headerMap = buildHeaderMap(headers);

  for (const requiredField of CUSTOMER_IMPORT_FIELDS.filter((field) => field.required)) {
    if (headerMap[requiredField.key] < 0) {
      issues.push({
        rowNumber: 1,
        field: requiredField.key,
        message: `Missing required column: ${requiredField.key}`,
      });
    }
  }

  if (issues.length > 0) {
    return { rows: [], issues, totalDataRows: 0 };
  }

  const rows: ParsedCustomerImportRow[] = [];
  const seenPhones = new Map<string, number>();
  let totalDataRows = 0;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex] ?? "";
    if (!rawLine.trim()) continue;

    const rowNumber = lineIndex + 1;
    const values = parseCsvLine(rawLine);
    const fullName = valueAt(values, headerMap.full_name);
    const phoneRaw = valueAt(values, headerMap.whatsapp_number);
    const customerSegment = valueAt(values, headerMap.customer_segment);
    const area = valueAt(values, headerMap.area);
    const notes = valueAt(values, headerMap.notes);

    if (!fullName && !phoneRaw && !customerSegment && !area && !notes) {
      continue;
    }

    totalDataRows += 1;
    let rowValid = true;

    if (fullName.length < 2) {
      issues.push({
        rowNumber,
        field: "full_name",
        message: "Full name is required.",
        value: fullName,
      });
      rowValid = false;
    }

    if (!phoneRaw) {
      issues.push({
        rowNumber,
        field: "whatsapp_number",
        message: "WhatsApp number is required.",
      });
      rowValid = false;
    }

    const whatsappE164 = normalizeBangladeshPhone(phoneRaw);
    if (phoneRaw && !STRICT_BD_WHATSAPP.test(whatsappE164)) {
      issues.push({
        rowNumber,
        field: "whatsapp_number",
        message: "Number must follow +8801xxxxxxxxx format.",
        value: phoneRaw,
      });
      rowValid = false;
    }

    if (fullName.length > 120) {
      issues.push({
        rowNumber,
        field: "full_name",
        message: "Full name is too long (max 120 chars).",
      });
      rowValid = false;
    }

    if (customerSegment.length > 80) {
      issues.push({
        rowNumber,
        field: "customer_segment",
        message: "Customer segment is too long (max 80 chars).",
      });
      rowValid = false;
    }

    if (area.length > 80) {
      issues.push({
        rowNumber,
        field: "area",
        message: "Area is too long (max 80 chars).",
      });
      rowValid = false;
    }

    if (notes.length > 500) {
      issues.push({
        rowNumber,
        field: "notes",
        message: "Notes are too long (max 500 chars).",
      });
      rowValid = false;
    }

    if (rowValid && seenPhones.has(whatsappE164)) {
      issues.push({
        rowNumber,
        field: "whatsapp_number",
        message: `Duplicate number in file (first seen at row ${seenPhones.get(whatsappE164)}).`,
        value: whatsappE164,
      });
      rowValid = false;
    }

    if (!rowValid) continue;

    seenPhones.set(whatsappE164, rowNumber);
    rows.push({
      rowNumber,
      fullName,
      whatsappNumberRaw: phoneRaw,
      whatsappE164,
      customerSegment: customerSegment || null,
      area: area || null,
      notes: notes || null,
    });
  }

  return {
    rows,
    issues,
    totalDataRows,
  };
}

export function buildCustomerImportCsvTemplate(): string {
  return [
    "full_name,whatsapp_number,customer_segment,area,notes",
    "Example Customer,+8801712345678,Retail,Dhaka,Monthly campaign priority",
    "Example Client,+8801812345678,Wholesale,Chattogram,Handles bulk orders",
  ].join("\n");
}
