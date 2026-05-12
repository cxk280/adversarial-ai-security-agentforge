import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
  configuredPassword,
  expectedCookieValue,
} from "@/lib/auth-cookie";

/**
 * POST /api/login
 *
 * Body: `{ password: string }`
 *
 * - If ADVERSARY_UI_PASSWORD is unset: returns 204 (auth disabled,
 *   no cookie needed). The login page will just redirect to `/` on
 *   any 2xx response.
 * - If body password matches the configured password: sets the
 *   adv-auth cookie and returns 204.
 * - Otherwise: 401 with `{ error: "Incorrect password" }`.
 *
 * Constant-time-ish comparison is used for the hash to avoid leaking
 * timing info — we hash both candidate and configured, then compare
 * the resulting fixed-length hex strings character-by-character.
 */
export async function POST(req: NextRequest) {
  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const submitted = typeof body.password === "string" ? body.password : "";

  const configured = configuredPassword();
  if (!configured) {
    // Auth disabled (local dev) — still issue the cookie so a later
    // redeploy that turns auth on doesn't immediately log everyone
    // out. The cookie is harmless when password is unset.
    const resp = NextResponse.json({ ok: true, authDisabled: true });
    return resp;
  }

  const submittedHash = await expectedCookieValue(submitted);
  const configuredHash = await expectedCookieValue(configured);

  if (!constantTimeEqual(submittedHash, configuredHash)) {
    return NextResponse.json(
      { error: "Incorrect password" },
      { status: 401 },
    );
  }

  const resp = NextResponse.json({ ok: true });
  resp.cookies.set({
    name: COOKIE_NAME,
    value: configuredHash,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return resp;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
