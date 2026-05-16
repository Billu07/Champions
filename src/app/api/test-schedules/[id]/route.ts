import { z } from "zod";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
import { fail, ok } from "@/lib/http";
import { cancelTestSchedule } from "@/lib/test-scheduler";

const idSchema = z.string().uuid();

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER) {
    return fail("Test scheduler disabled", 404);
  }

  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  try {
    const params = await context.params;
    const parsed = idSchema.safeParse(params.id);
    if (!parsed.success) {
      return fail("Invalid schedule id", 400);
    }

    const cancelled = await cancelTestSchedule(parsed.data);
    if (!cancelled) {
      return fail("Schedule not found or already processed", 404);
    }

    return ok({ ok: true });
  } catch (error) {
    return fail((error as Error).message || "Failed to cancel schedule", 500);
  }
}
