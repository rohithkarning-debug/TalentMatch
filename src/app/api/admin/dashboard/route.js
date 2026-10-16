import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { loadDashboard } from "@/lib/admin/dashboard";

// GET /api/admin/dashboard: every number on the admin analytics page.
export const GET = withAuth({ roles: [ROLES.ADMIN] }, async () => {
  return NextResponse.json(await loadDashboard(), { headers: { "Cache-Control": "no-store" } });
});
