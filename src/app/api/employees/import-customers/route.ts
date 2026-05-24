import { z } from "zod";
import { requestHasAdminSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { parseCustomerImportCsv } from "@/lib/customer-import";
import { listEmployees, upsertEmployee, upsertTag } from "@/lib/repository";

const payloadSchema = z.object({
  csvText: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().default(true),
});

const MAX_VALID_ROWS_PER_IMPORT = 2000;
const ISSUE_PREVIEW_LIMIT = 120;

type ImportIssue = {
  rowNumber: number;
  field: string;
  message: string;
  value?: string;
};

function uniqueTagKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.map((key) => key.trim().toLowerCase()).filter(Boolean)));
}

function limitIssues(issues: ImportIssue[]) {
  return {
    items: issues.slice(0, ISSUE_PREVIEW_LIMIT),
    total: issues.length,
    truncated: issues.length > ISSUE_PREVIEW_LIMIT,
  };
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => ({}));
  const parsedBody = payloadSchema.safeParse(body);

  if (!parsedBody.success) {
    return fail(parsedBody.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  const { rows, issues, totalDataRows } = parseCustomerImportCsv(parsedBody.data.csvText);
  if (rows.length > MAX_VALID_ROWS_PER_IMPORT) {
    return fail(`Too many valid rows in one file. Maximum allowed is ${MAX_VALID_ROWS_PER_IMPORT}.`, 400);
  }

  const employees = await listEmployees();
  const employeeByPhone = new Map(
    employees.map((employee) => [employee.whatsapp_e164, employee]),
  );

  const wouldUpdate = rows.filter((row) => employeeByPhone.has(row.whatsappE164)).length;
  const wouldInsert = rows.length - wouldUpdate;

  if (parsedBody.data.dryRun) {
    return ok({
      dryRun: true,
      totalDataRows,
      validRows: rows.length,
      wouldInsert,
      wouldUpdate,
      skipped: totalDataRows - rows.length,
      issues: limitIssues(issues),
    });
  }

  if (rows.length === 0) {
    return fail("No valid customer rows found for import.", 400);
  }

  await upsertTag({ key: "customers", label: "Customers" }).catch(() => undefined);

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const runtimeIssues: ImportIssue[] = [...issues];

  for (const row of rows) {
    const existing = employeeByPhone.get(row.whatsappE164);
    const existingTagKeys = existing?.tags?.map((tag) => String(tag.key)) ?? [];
    const tagKeys = uniqueTagKeys([...existingTagKeys, "customers"]);

    try {
      const employeeId = await upsertEmployee({
        id: existing?.id,
        fullName: row.fullName,
        designation: existing?.designation || "Customer",
        department: row.customerSegment ?? existing?.department ?? "Customer",
        branch: row.area ?? existing?.branch ?? "",
        whatsappNumber: row.whatsappE164,
        trackingEnabled: existing?.tracking_enabled ?? false,
        isActive: existing?.is_active ?? true,
        status: existing?.status || "Active",
        aliases: existing?.aliases ?? [],
        notes: row.notes ?? existing?.notes ?? "",
        tagKeys,
      });

      if (existing) {
        updated += 1;
      } else {
        inserted += 1;
      }

      employeeByPhone.set(row.whatsappE164, {
        id: employeeId,
        full_name: row.fullName,
        designation: existing?.designation || "Customer",
        department: row.customerSegment ?? existing?.department ?? "Customer",
        branch: row.area ?? existing?.branch ?? null,
        whatsapp_number_raw: row.whatsappNumberRaw,
        whatsapp_e164: row.whatsappE164,
        tracking_enabled: existing?.tracking_enabled ?? false,
        is_active: existing?.is_active ?? true,
        status: existing?.status || "Active",
        aliases: existing?.aliases ?? [],
        notes: row.notes ?? existing?.notes ?? null,
        tags: tagKeys.map((key) => ({ key, label: key === "customers" ? "Customers" : key })),
      });
    } catch (error) {
      failed += 1;
      runtimeIssues.push({
        rowNumber: row.rowNumber,
        field: "row",
        message: error instanceof Error ? error.message : "Import failed for this row.",
      });
    }
  }

  return ok({
    dryRun: false,
    totalDataRows,
    validRows: rows.length,
    wouldInsert,
    wouldUpdate,
    imported: inserted + updated,
    inserted,
    updated,
    failed,
    skipped: totalDataRows - rows.length,
    issues: limitIssues(runtimeIssues),
  });
}
