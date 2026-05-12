import { z } from "zod";
import { assertCronSecret } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { runScheduledSlot } from "@/lib/scheduling";

const schema = z.object({
  slot: z.enum(["morning", "noon", "afternoon", "evening"]),
});

export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const url = new URL(request.url);
    const parsed = schema.safeParse({ slot: url.searchParams.get("slot") });

    if (!parsed.success) {
      return fail("Invalid slot query param", 400);
    }

    const result = await runScheduledSlot(parsed.data.slot);
    return ok({ ok: true, result });
  } catch (error) {
    return fail((error as Error).message, 401);
  }
}
