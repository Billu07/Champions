import { fail, ok } from "@/lib/http";
import { assertCronSecret } from "@/lib/auth";
import { generateMonthlyReport } from "@/lib/reporting";

export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");

    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return fail("Invalid date format. Use YYYY-MM-DD", 400);
    }

    const anchorDate = dateParam ? new Date(`${dateParam}T12:00:00.000Z`) : new Date();
    const result = await generateMonthlyReport(anchorDate);
    return ok({ ok: true, result });
  } catch (error) {
    return fail((error as Error).message, 401);
  }
}
