import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/request";
import { withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";

// POST /api/notifications/read-all: mark every unread notification of the
// session user as read. Returns how many were changed.
export const POST = withAuth({}, async (request, { user }) => {
  assertSameOrigin(request);
  const { rowCount } = await query(
    "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND NOT is_read", [user.id]);
  return NextResponse.json({ updated: rowCount }, { headers: { "Cache-Control": "no-store" } });
});
