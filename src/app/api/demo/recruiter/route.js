import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";

// GET /api/demo/recruiter — demonstration of a recruiter-only route (Stage 3).
// 401 without a session, 403 for any other role, 200 for recruiters.
export const GET = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user }) => {
  return NextResponse.json({ ok: true, access: "recruiter", user });
});
