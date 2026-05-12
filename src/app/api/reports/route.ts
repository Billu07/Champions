import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { listReports } from "@/lib/repository";

export async function GET(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 40);
  const reports = await listReports(Number.isFinite(limit) ? Math.min(limit, 100) : 40);
  return ok({ reports });
}
