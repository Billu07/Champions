import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import type { ReportKind } from "@/lib/types";
import { listReports } from "@/lib/repository";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(300).default(60),
  kind: z.enum(["individual_daily", "team_daily", "team_weekly", "team_monthly", "all"]).default("all"),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid query", 400);
  }

  const reports = await listReports({
    limit: parsed.data.limit,
    kind: parsed.data.kind as ReportKind | "all",
    fromDate: parsed.data.from,
    toDate: parsed.data.to,
  });

  return ok({ reports });
}
