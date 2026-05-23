import { z } from "zod";
import { assertCronSecret } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { runDueScheduleLabDispatch, runScheduledSlot } from "@/lib/scheduling";

const schema = z.object({
  slot: z.enum(["morning", "noon", "afternoon", "evening"]).optional(),
});

export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const url = new URL(request.url);
    const parsed = schema.safeParse({ slot: url.searchParams.get("slot") ?? undefined });

    if (!parsed.success) {
      return fail("Invalid slot query param", 400);
    }

    if (parsed.data.slot) {
      const legacyResult = await runScheduledSlot(parsed.data.slot);
      return ok({ ok: true, mode: "legacy_slot", result: legacyResult });
    }

    const result = await runDueScheduleLabDispatch(new Date());
    return ok({ ok: true, mode: "schedule_lab_dispatch", result });
  } catch (error) {
    return fail((error as Error).message, 401);
  }
}
