import { NextResponse } from "next/server";
import { ApiError, jsonError } from "@/lib/api/errors";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { setSessionCookie } from "@/lib/auth/cookie";
import { withErrorHandling } from "@/lib/auth/guards";
import { signSessionToken } from "@/lib/auth/jwt";
import { clientIp, loginKey, loginRateLimiter } from "@/lib/auth/login-rate-limit";
import { verifyPassword } from "@/lib/auth/password";
import { toSafeUser } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { loginSchema } from "@/lib/validation/auth";

const invalidCredentials = () =>
  new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");

// POST /api/auth/login
export const POST = withErrorHandling(async (request) => {
  assertSameOrigin(request);
  const { email, password } = await readJsonBody(request, loginSchema);

  // Rate limit per email + IP (src/lib/auth/login-rate-limit.js): the attempt
  // is counted before the password check; a successful login resets it.
  // Invalid input (400 above) is not counted. The 429 says nothing about
  // whether the account exists.
  const key = loginKey(email, clientIp(request.headers));
  const limit = loginRateLimiter.consume(key);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    const response = jsonError(429, "TOO_MANY_ATTEMPTS",
      `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const { rows } = await query(
    "SELECT user_id, email, full_name, role, is_active, password_hash FROM users WHERE email = $1",
    [email]
  );
  const row = rows[0];

  // Always run bcrypt (against a dummy hash if the email is unknown) and give
  // the SAME error for "no such email" and "wrong password", so an attacker
  // cannot discover which emails are registered.
  const ok = await verifyPassword(password, row?.password_hash ?? null);
  if (!row || !ok) throw invalidCredentials();

  // Only revealed to someone who knows the correct password.
  if (!row.is_active) {
    throw new ApiError(403, "ACCOUNT_DISABLED", "This account has been disabled");
  }

  loginRateLimiter.reset(key);
  await query("UPDATE users SET last_login_at = now() WHERE user_id = $1", [row.user_id]);

  const user = toSafeUser(row); // password_hash is dropped here
  const token = await signSessionToken(user);
  const response = NextResponse.json({ user }, { status: 200, headers: { "Cache-Control": "no-store" } });
  return setSessionCookie(response, token);
});
