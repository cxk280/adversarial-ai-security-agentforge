/**
 * Auth cookie helpers — shared between the middleware (edge runtime),
 * the /api/login route, and the /api/logout route. Keeping the cookie
 * name and the expected-value derivation in one place means there's
 * exactly one source of truth for "is this request authenticated."
 *
 * Design (deliberately simple — single password, no user accounts):
 *
 *   - Cookie name: `adv-auth`
 *   - Cookie value: hex(sha256(PASSWORD + "adv-ui-v1"))
 *   - PASSWORD is read from process.env.ADVERSARY_UI_PASSWORD at request
 *     time. If unset, auth is fully disabled — useful for local dev,
 *     CI, and the standalone Docker run. Production deploys set the
 *     env var on the Railway service to lock down access.
 *
 * No session store. Stateless. The cookie is HttpOnly + SameSite=Lax +
 * Secure-in-production, so it can't be exfiltrated from JS and won't
 * leak on cross-origin GET. The cookie expires in 7 days; users
 * re-authenticate after that.
 */

export const COOKIE_NAME = "adv-auth";
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SALT = "adv-ui-v1";

/** Edge-runtime-compatible SHA-256 of `password + SALT`, hex-encoded. */
export async function expectedCookieValue(password: string): Promise<string> {
  const data = new TextEncoder().encode(password + SALT);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Resolve the configured password (returns undefined when auth is disabled). */
export function configuredPassword(): string | undefined {
  return process.env.ADVERSARY_UI_PASSWORD;
}
