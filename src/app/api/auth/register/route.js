import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { setSessionCookie } from "@/lib/auth/cookie";
import { withErrorHandling } from "@/lib/auth/guards";
import { signSessionToken } from "@/lib/auth/jwt";
import { hashPassword } from "@/lib/auth/password";
import { toSafeUser } from "@/lib/auth/session";
import { getPool } from "@/lib/db";
import { registerSchema } from "@/lib/validation/auth";

// POST /api/auth/register  — public candidate sign-up.
// The role is hard-coded to 'candidate' below; the request body cannot contain
// a role at all (registerSchema is strict). Admin and recruiter accounts are
// created by an admin, never through this endpoint.
export const POST = withErrorHandling(async (request) => {
  assertSameOrigin(request);
  const { fullName, email, password } = await readJsonBody(request, registerSchema);
  const passwordHash = await hashPassword(password);

  // Transaction: a users row and its candidates profile are created together
  // or not at all.
  const client = await getPool().connect();
  let user;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'candidate')
       RETURNING user_id, email, full_name, role`,
      [email, passwordHash, fullName]
    );
    await client.query("INSERT INTO candidates (user_id) VALUES ($1)", [rows[0].user_id]);
    await client.query("COMMIT");
    user = toSafeUser(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    // UNIQUE(email) is the real guard, so two simultaneous sign-ups with the
    // same email cannot both succeed.
    if (err.code === "23505" && err.constraint === "users_email_key") {
      throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
    }
    throw err;
  } finally {
    client.release();
  }

  const token = await signSessionToken(user);
  const response = NextResponse.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
  return setSessionCookie(response, token);
});
