import { fail, ok } from "@/lib/http";
import { assertCronSecret } from "@/lib/auth";
import { env } from "@/lib/config";
import { dhakaDateISO } from "@/lib/time";
import { generateDailyReports } from "@/lib/reporting";

export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || dhakaDateISO(new Date(), env.NEXT_PUBLIC_APP_TIMEZONE);

    const result = await generateDailyReports(date);
    return ok({ ok: true, result });
  } catch (error) {
    return fail((error as Error).message, 401);
  }
}
