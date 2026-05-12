import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { listTags, upsertTag } from "@/lib/repository";

const schema = z.object({
  key: z.string().min(2),
  label: z.string().min(2),
});

export async function GET(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  return ok({ tags: await listTags() });
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  const tag = await upsertTag(parsed.data);
  return ok({ tag });
}
