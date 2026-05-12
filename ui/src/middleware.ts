import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_NAME,
  configuredPassword,
  expectedCookieValue,
} from "@/lib/auth-cookie";

/**
 * Auth middleware. Runs on every request that matches `matcher` below.
 *
 * Behaviors:
 *   - If ADVERSARY_UI_PASSWORD is unset → bypass entirely (local dev).
 *   - Allow /login, /api/login, /api/logout, /api/health, /favicon.ico
 *     and Next's own static asset paths without auth.
 *   - For everything else, require the adv-auth cookie to match
 *     hex(sha256(PASSWORD + salt)). Mismatch → 302 to /login with a
 *     `?from=` so we can redirect back after sign-in.
 */
export async function middleware(req: NextRequest) {
  const password = configuredPassword();
  if (!password) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const expected = await expectedCookieValue(password);

  if (cookie === expected) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // Carry the original path forward so the login page can bounce back
  // to wherever the user was trying to go.
  url.searchParams.set("from", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on all paths EXCEPT the explicit allowlist. Next's "matcher"
  // syntax doesn't support multi-segment negation reliably, so we
  // catch-all here and short-circuit unauthed paths inside the
  // middleware body.
  matcher: [
    "/((?!login|api/login|api/logout|api/health|favicon.ico|_next/static|_next/image).*)",
  ],
};
