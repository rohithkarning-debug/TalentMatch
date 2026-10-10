import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { getPool, query } from "@/lib/db";
import { candidateProfileSchema } from "@/lib/candidate/validation";

export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (_request, { user }) => {
  const { rows } = await query(
    `SELECT u.user_id::int AS id, u.email, u.full_name AS "fullName",
            c.phone, c.location, c.headline,
            c.years_experience::float8 AS "yearsExperience",
            c.highest_education AS "highestEducation", c.created_at AS "createdAt"
       FROM users u JOIN candidates c ON c.user_id = u.user_id
      WHERE u.user_id = $1`, [user.id]);
  if (!rows[0]) throw notFound("Candidate profile not found");
  return NextResponse.json({ profile: rows[0] }, { headers: { "Cache-Control": "no-store" } });
});

export const PATCH = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user }) => {
  assertSameOrigin(request);
  const data = await readJsonBody(request, candidateProfileSchema);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (data.fullName !== undefined) {
      await client.query("UPDATE users SET full_name = $1 WHERE user_id = $2", [data.fullName, user.id]);
    }
    const mapping = [
      ["phone", "phone"], ["location", "location"], ["headline", "headline"],
      ["yearsExperience", "years_experience"], ["highestEducation", "highest_education"],
    ];
    const values = [];
    const sets = [];
    for (const [key, column] of mapping) {
      if (data[key] !== undefined) {
        values.push(data[key] === "" ? null : data[key]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length) {
      values.push(user.id);
      const result = await client.query(`UPDATE candidates SET ${sets.join(", ")} WHERE user_id = $${values.length} RETURNING user_id`, values);
      if (!result.rowCount) throw notFound("Candidate profile not found");
    }
    const { rows } = await client.query(
      `SELECT u.user_id::int AS id, u.email, u.full_name AS "fullName", c.phone, c.location, c.headline,
              c.years_experience::float8 AS "yearsExperience", c.highest_education AS "highestEducation", c.created_at AS "createdAt"
         FROM users u JOIN candidates c ON c.user_id = u.user_id WHERE u.user_id = $1`, [user.id]);
    await client.query("COMMIT");
    return NextResponse.json({ profile: rows[0] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
});
