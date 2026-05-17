import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { buildBroadcastPreview } from "@/lib/broadcast-routing";
import { logError } from "@/lib/logger";
import { insertMentionAudit, listEmployees } from "@/lib/repository";
import type { BroadcastPreviewRequest } from "@/lib/types";

const schema = z.object({
  message: z.string().min(1),
  audienceCategory: z.enum(["sales_team", "head_office", "drivers", "customers", "all", "custom"]).default("custom"),
  selectedEmployeeIds: z.array(z.string().uuid()).default([]),
  selectedTagKeys: z.array(z.string()).default([]),
  useAiRouting: z.boolean().default(true),
});

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => ({}))) as BroadcastPreviewRequest;
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  try {
    const allEmployees = await listEmployees();

    const preview = await buildBroadcastPreview(
      {
        message: parsed.data.message,
        audienceCategory: parsed.data.audienceCategory,
        selectedEmployeeIds: parsed.data.selectedEmployeeIds,
        selectedTagKeys: parsed.data.selectedTagKeys,
        useAiRouting: parsed.data.useAiRouting,
      },
      allEmployees,
    );

    try {
      await insertMentionAudit({
        messageBody: parsed.data.message,
        extractedNames: preview.extractedMentionNames,
        resolvedEmployeeIds: preview.mentionMatches.map((item) => item.employeeId),
        unresolvedNames: preview.unresolvedMentions,
      });
    } catch (error) {
      logError("Mention audit insert failed", {
        error: (error as Error).message,
      });
    }

    const employeesById = new Map(allEmployees.map((employee) => [employee.id, employee]));
    const recipients = preview.recipients
      .map((id) => employeesById.get(id))
      .filter((employee): employee is (typeof allEmployees)[number] => Boolean(employee))
      .map((employee) => ({
        id: employee.id,
        full_name: employee.full_name,
        whatsapp_e164: employee.whatsapp_e164,
        department: employee.department,
        designation: employee.designation,
        tags: employee.tags,
      }));

    return ok({
      recipients,
      routes: preview.routes,
      mentionMatches: preview.mentionMatches,
      unresolvedMentions: preview.unresolvedMentions,
      unresolvedAiTargets: preview.unresolvedAiTargets,
      enhancedMessage: preview.enhancedMessage,
      aiDiagnostics: preview.aiDiagnostics,
    });
  } catch (error) {
    logError("Broadcast preview failed", {
      error: (error as Error).message,
    });
    return fail((error as Error).message || "Failed to generate broadcast preview", 500);
  }
}
