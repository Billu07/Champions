import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { deleteConversationMessageEventsByIds } from "@/lib/repository";

const schema = z.object({
  eventIds: z.array(z.string().uuid()).min(1).max(1500),
});

export async function DELETE(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  const deleted = await deleteConversationMessageEventsByIds(parsed.data.eventIds);
  return ok({ deleted });
}
