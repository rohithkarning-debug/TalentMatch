import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/guards";

// GET /api/auth/me — the logged-in user's safe profile, or 401.
export const GET = withAuth({}, async (request, { user }) => {
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
});
