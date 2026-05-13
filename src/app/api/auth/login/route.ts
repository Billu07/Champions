import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");

  const success = await createSession(password);

  if (!success) {
    const url = new URL("/login?error=1", request.url);
    return NextResponse.redirect(url);
  }

  const url = new URL("/dashboard", request.url);
  return NextResponse.redirect(url);
}
