import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth-cookie";

/**
 * POST /api/logout — clears the adv-auth cookie. Middleware will
 * redirect the next request to /login.
 */
export async function POST() {
  const resp = NextResponse.json({ ok: true });
  resp.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return resp;
}
