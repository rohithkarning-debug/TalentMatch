import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { setSessionCookie } from "@/lib/auth/cookie";
import { withErrorHandling } from "@/lib/auth/guards";
import { signSessionToken } from "@/lib/auth/jwt";
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

  await query("UPDATE users SET last_login_at = now() WHERE user_id = $1", [row.user_id]);

  const user = toSafeUser(row); // password_hash is dropped here
  const token = await signSessionToken(user);
  const response = NextResponse.json({ user }, { status: 200, headers: { "Cache-Control": "no-store" } });
  return setSessionCookie(response, token);
});
