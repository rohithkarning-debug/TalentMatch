import "server-only";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { forbidden, handleApiError, unauthorized } from "../api/errors.js";
import { getUserFromRequest } from "./session.js";

// Server-side authorization helpers. EVERY protected route handler must use
// these (directly or through withAuth). Hiding buttons in the UI is never a
// security measure on its own.

export const ROLES = Object.freeze({
  ADMIN: "admin",
  RECRUITER: "recruiter",
  CANDIDATE: "candidate",
});

// 401 if there is no valid session.
export async function requireUser(request) {
  const user = await getUserFromRequest(request);
  if (!user) throw unauthorized();
  return user;
}

// 403 if the (already authenticated) user's role is not in the list.
export function assertRole(user, roles) {
  if (!roles.includes(user.role)) throw forbidden();
}

// 401 if not logged in, 403 if logged in with the wrong role.
export async function requireRole(request, ...roles) {
  const user = await requireUser(request);
  assertRole(user, roles);
  return user;
}

export const requireAdmin = (request) => requireRole(request, ROLES.ADMIN);
export const requireRecruiter = (request) => requireRole(request, ROLES.RECRUITER);
export const requireCandidate = (request) => requireRole(request, ROLES.CANDIDATE);

// Ownership is not checked here. Each query enforces it in SQL
// (WHERE … AND candidate_id = <session user>), so another user's record
// simply is not found (404). Company-scoped recruiter records use
// assertJobInRecruiterCompany / assertApplicationInRecruiterCompany
// (src/lib/recruiter/jobs.js), which return 403.

// Route-handler wrapper:
//   export const GET = withAuth({ roles: ["admin"] }, async (request, { user, params }) => { ... });
// - resolves the user (401) and checks roles (403) BEFORE the handler runs
// - awaits dynamic route params
// - converts thrown errors into the standard JSON error format
// connection() marks the route as request-time only (never prerendered at
// build), and unstable_rethrow lets Next.js's own control-flow errors pass
// through instead of being turned into a 500.
export function withAuth(options, handler) {
  const roles = options?.roles;
  return async function authenticatedRoute(request, context) {
    try {
      await connection();
      const user = await requireUser(request);
      if (roles) assertRole(user, roles);
      const params = context?.params ? await context.params : {};
      return await handler(request, { user, params });
    } catch (err) {
      unstable_rethrow(err);
      return handleApiError(err);
    }
  };
}

// Same error handling for public routes (login, register).
export function withErrorHandling(handler) {
  return async function publicRoute(request, context) {
    try {
      await connection();
      const params = context?.params ? await context.params : {};
      return await handler(request, { params });
    } catch (err) {
      unstable_rethrow(err);
      return handleApiError(err);
    }
  };
}
