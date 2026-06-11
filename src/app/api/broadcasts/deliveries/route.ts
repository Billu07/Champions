import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { getBroadcastDeliveryBreakdown } from "@/lib/repository";
import { logError } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    if (!(await requestHasAdminSession(request))) {
      return fail("Unauthorized", 401);
    }

    const campaignId = new URL(request.url).searchParams.get("campaignId")?.trim();
    if (!campaignId) {
      return fail("campaignId is required", 400);
    }

    const recipients = await getBroadcastDeliveryBreakdown(campaignId);
    const counts = recipients.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const undelivered = recipients.filter((row) => row.status === "accepted" || row.status === "failed").length;

    return ok({ campaignId, total: recipients.length, undelivered, counts, recipients });
  } catch (error) {
    const message = (error as Error).message || "Failed to load delivery status";
    logError("Broadcast deliveries lookup failed", { error: message });
    return fail(message, 500);
  }
}
