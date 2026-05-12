import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST(request: Request) {
  await destroySession();
  const url = new URL("/login", request.url);
  return NextResponse.redirect(url);
}
