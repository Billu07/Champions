import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { enhanceCeoMessage } from "@/lib/ai";
import { resolveMentions } from "@/lib/mention";
import {
  getEmployeesByIds,
  getEmployeesByTagKeys,
  insertMentionAudit,
  listEmployees,
} from "@/lib/repository";
import type { BroadcastPreviewRequest } from "@/lib/types";

const schema = z.object({
  message: z.string().min(1),
  selectedEmployeeIds: z.array(z.string().uuid()).default([]),
  selectedTagKeys: z.array(z.string()).default([]),
});

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => ({}))) as BroadcastPreviewRequest;
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  const allEmployees = (await listEmployees()).filter((employee) => employee.is_active);

  const selectedById = await getEmployeesByIds(parsed.data.selectedEmployeeIds);
  const selectedByTag = await getEmployeesByTagKeys(parsed.data.selectedTagKeys);

  const mentionResult = await resolveMentions(parsed.data.message, allEmployees);
  const mentionEmployees = await getEmployeesByIds(mentionResult.matches.map((item) => item.employeeId));

  const recipients = dedupeById([...selectedById, ...selectedByTag, ...mentionEmployees]);

  await insertMentionAudit({
    messageBody: parsed.data.message,
    extractedNames: mentionResult.extractedNames,
    resolvedEmployeeIds: mentionResult.matches.map((item) => item.employeeId),
    unresolvedNames: mentionResult.unresolved,
  });

  const enhancedMessage = await enhanceCeoMessage(parsed.data.message);

  return ok({
    recipients,
    mentionMatches: mentionResult.matches,
    unresolvedMentions: mentionResult.unresolved,
    enhancedMessage,
  });
}
