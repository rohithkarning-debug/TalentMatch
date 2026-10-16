import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { candidateSkillSchema } from "@/lib/candidate/validation";

export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (_request, { user }) => {
  const [catalog, mine] = await Promise.all([
    query("SELECT skill_id AS id, name, category FROM skills ORDER BY category, name"),
    query(`SELECT s.skill_id AS id, s.name, s.category, cs.proficiency, cs.years_used::float8 AS "yearsUsed"
             FROM candidate_skills cs JOIN skills s ON s.skill_id = cs.skill_id
            WHERE cs.candidate_id = $1 ORDER BY s.name`, [user.id]),
  ]);
  return NextResponse.json({ catalog: catalog.rows, skills: mine.rows }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user }) => {
  assertSameOrigin(request);
  const data = await readJsonBody(request, candidateSkillSchema);
  const skill = await query("SELECT skill_id FROM skills WHERE skill_id = $1", [data.skillId]);
  if (!skill.rowCount) throw notFound("Skill not found in the catalogue");
  // xmax is PostgreSQL's "deleted/updated by" marker on a row version: it is 0
  // for a freshly inserted row and non-zero when ON CONFLICT updated an existing
  // one. That tells us, in the same atomic statement, which case happened.
  const { rows } = await query(
    `INSERT INTO candidate_skills (candidate_id, skill_id, proficiency, years_used)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (candidate_id, skill_id) DO UPDATE SET proficiency = EXCLUDED.proficiency, years_used = EXCLUDED.years_used
     RETURNING (xmax = 0) AS inserted`, [user.id, data.skillId, data.proficiency, data.yearsUsed]);
  const created = rows[0].inserted;
  return NextResponse.json({ ok: true, skillId: data.skillId, created }, { status: created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
});
