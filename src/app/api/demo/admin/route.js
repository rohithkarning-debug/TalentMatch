import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";

// GET /api/demo/admin — demonstration of a admin-only route (Stage 3).
// 401 without a session, 403 for any other role, 200 for admins.
export const GET = withAuth({ roles: [ROLES.ADMIN] }, async (request, { user }) => {
  return NextResponse.json({ ok: true, access: "admin", user });
});
