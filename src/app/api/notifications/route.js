import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { notificationListQuerySchema } from "@/lib/validation/pipeline";

// GET /api/notifications?unreadOnly=true|false&limit=N  (any signed-in role)
// Always filtered by the session user's id. There is no way to ask for
// another user's notifications. The unread count uses the partial index
// notifications_unread_idx (WHERE NOT is_read).
export const GET = withAuth({}, async (request, { user }) => {
  const { unreadOnly, limit } = notificationListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));

  const [list, unread] = await Promise.all([
    query(
      `SELECT notification_id::int AS id, type, title, message,
              related_application_id::int AS "applicationId", is_read AS "isRead", created_at AS "createdAt"
         FROM notifications
        WHERE user_id = $1 AND (NOT $2::boolean OR NOT is_read)
        ORDER BY created_at DESC, notification_id DESC
        LIMIT $3`, [user.id, unreadOnly, limit]),
    query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read", [user.id]),
  ]);
  return NextResponse.json({ notifications: list.rows, unreadCount: unread.rows[0].n },
    { headers: { "Cache-Control": "no-store" } });
});
