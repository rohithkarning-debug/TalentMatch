import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";

export const DELETE = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const parsed = idParamSchema.safeParse(params.skillId);
  if (!parsed.success) throw notFound("Skill assignment not found");
  const result = await query("DELETE FROM candidate_skills WHERE candidate_id = $1 AND skill_id = $2 RETURNING skill_id", [user.id, parsed.data]);
  if (!result.rowCount) throw notFound("Skill assignment not found");
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
