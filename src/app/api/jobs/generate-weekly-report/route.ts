import { fail, ok } from "@/lib/http";
import { assertCronSecret } from "@/lib/auth";
import { generateWeeklyReport } from "@/lib/reporting";

export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const result = await generateWeeklyReport(new Date());
    return ok({ ok: true, result });
  } catch (error) {
    return fail((error as Error).message, 401);
  }
}
