import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
import { createTestSchedule, listTestSchedules } from "@/lib/test-scheduler";

const createSchema = z.object({
  templateKey: z.enum(["morning", "noon", "afternoon", "evening", "ceo_broadcast_test"]),
  scheduledAtIso: z.string().datetime(),
  recipientEmployeeIds: z.array(z.string().uuid()).min(1),
  morningBodyText: z.string().max(1500).optional().default(""),
});

export async function GET(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }
  if (!env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER) {
    return fail("Test scheduler disabled", 404);
  }

  try {
    const schedules = await listTestSchedules();
    return ok({ schedules });
  } catch (error) {
    return fail((error as Error).message || "Failed to load test schedules", 500);
  }
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }
  if (!env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER) {
    return fail("Test scheduler disabled", 404);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message || "Invalid payload", 400);
    }

    const created = await createTestSchedule(parsed.data);
    return ok({ created }, 201);
  } catch (error) {
    return fail((error as Error).message || "Failed to create test schedule", 500);
  }
}
