import { NextResponse } from "next/server";
import { badRequest, notFound } from "@/lib/api/errors";
import { assertOwnerOrAdmin, withAuth } from "@/lib/auth/guards";
import { toSafeUser } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";

// GET /api/demo/users/:id — ownership demonstration (Stage 3).
// Any logged-in user may read THEIR OWN safe profile; admins may read anyone's.
// The pattern later stages follow: validate the id -> load the record ->
// check ownership against the owner id stored in the DATABASE.
export const GET = withAuth({}, async (request, { user, params }) => {
  const parsed = idParamSchema.safeParse(params.id);
  if (!parsed.success) throw badRequest("User id must be a positive integer");

  // Ownership check before the lookup, so non-admins cannot even learn
  // whether another user id exists.
  assertOwnerOrAdmin(user, parsed.data);

  const { rows } = await query(
    "SELECT user_id, email, full_name, role FROM users WHERE user_id = $1",
    [parsed.data]
  );
  if (!rows[0]) throw notFound("User not found");
  return NextResponse.json({ user: toSafeUser(rows[0]) });
});
