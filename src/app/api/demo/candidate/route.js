import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";

// GET /api/demo/candidate — demonstration of a candidate-only route (Stage 3).
// 401 without a session, 403 for any other role, 200 for candidates.
export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user }) => {
  return NextResponse.json({ ok: true, access: "candidate", user });
});
