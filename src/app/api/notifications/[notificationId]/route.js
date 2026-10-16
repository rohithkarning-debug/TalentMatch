import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";
import { notificationUpdateSchema } from "@/lib/validation/pipeline";

// PATCH /api/notifications/:notificationId { isRead: true }
// "AND user_id = $2" makes ownership part of the UPDATE itself: someone
// else's notification matches 0 rows and gets the same 404 as a missing one.
export const PATCH = withAuth({}, async (request, { user, params }) => {
  assertSameOrigin(request);
  const notificationId = idParamSchema.safeParse(params.notificationId);
  if (!notificationId.success) throw notFound("Notification not found");
  await readJsonBody(request, notificationUpdateSchema);

  const { rows } = await query(
    `UPDATE notifications SET is_read = TRUE
      WHERE notification_id = $1 AND user_id = $2
      RETURNING notification_id::int AS id, is_read AS "isRead"`, [notificationId.data, user.id]);
  if (!rows.length) throw notFound("Notification not found");
  return NextResponse.json({ notification: rows[0] }, { headers: { "Cache-Control": "no-store" } });
});
