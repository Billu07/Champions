import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { env } from "@/lib/config";
import { dhakaDateISO } from "@/lib/time";
import { getScheduledDeliverySummary } from "@/lib/repository";
import { logError } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    if (!(await requestHasAdminSession(request))) {
      return fail("Unauthorized", 401);
    }

    const dateParam = new URL(request.url).searchParams.get("date");
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : dhakaDateISO(new Date(), env.NEXT_PUBLIC_APP_TIMEZONE);

    const summary = await getScheduledDeliverySummary(date);
    return ok(summary);
  } catch (error) {
    const message = (error as Error).message || "Failed to load scheduled delivery summary";
    logError("Scheduled delivery summary failed", { error: message });
    return fail(message, 500);
  }
}
