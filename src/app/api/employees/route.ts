import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { listEmployees, upsertEmployee } from "@/lib/repository";

const employeeSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().min(2),
  designation: z.string().optional(),
  department: z.string().optional(),
  branch: z.string().optional(),
  whatsappNumber: z.string().min(7),
  trackingEnabled: z.boolean().default(false),
  isActive: z.boolean().default(true),
  status: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  notes: z.string().optional(),
  tagKeys: z.array(z.string()).default([]),
});

export async function GET(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const employees = await listEmployees();
  return ok({ employees });
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = employeeSchema.safeParse(body);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid payload", 400);
  }

  const id = await upsertEmployee(parsed.data);
  return ok({ id });
}
