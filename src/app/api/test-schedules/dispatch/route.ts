import { assertCronSecret, requestHasAdminSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { dispatchDueTestSchedules } from "@/lib/test-scheduler";

async function isAuthorized(request: Request): Promise<boolean> {
  if (await requestHasAdminSession(request)) return true;

  try {
    assertCronSecret(request);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return fail("Unauthorized", 401);
  }

  try {
    const result = await dispatchDueTestSchedules(new Date());
    return ok({ ok: true, result });
  } catch (error) {
    return fail((error as Error).message || "Failed to dispatch due schedules", 500);
  }
}
