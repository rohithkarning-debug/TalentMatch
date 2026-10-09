import "server-only";
import { cookies } from "next/headers";
import { query } from "../db.js";
import { SESSION_COOKIE } from "./cookie.js";
import { verifySessionToken } from "./jwt.js";

// The only user shape that ever leaves the server. No password hash, no flags.
export function toSafeUser(row) {
  return {
    id: Number(row.user_id),
    email: row.email,
    fullName: row.full_name,
    role: row.role,
  };
}

// Token -> current user, or null.
// The JWT proves WHO the user is; the database is the source of truth for
// WHAT they may do. We re-read the user on every request so that a
// deactivated account or a changed role takes effect immediately, and a token
// whose role no longer matches the database is rejected.
export async function loadSessionUser(token) {
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const { rows } = await query(
    "SELECT user_id, email, full_name, role, is_active FROM users WHERE user_id = $1",
    [claims.userId]
  );
  const row = rows[0];
  if (!row || !row.is_active || row.role !== claims.role) return null;
  return toSafeUser(row);
}

// For Route Handlers: reads the cookie from the incoming request.
export function getUserFromRequest(request) {
  return loadSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
}

// For Server Components: reads the cookie via next/headers.
// With Cache Components enabled, call this only inside a <Suspense> boundary.
export async function getCurrentUser() {
  const store = await cookies();
  return loadSessionUser(store.get(SESSION_COOKIE)?.value);
}
