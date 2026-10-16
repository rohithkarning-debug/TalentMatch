import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { forbidden } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { getPool, query } from "@/lib/db";
import { loadJobDetail, replaceJobSkills } from "@/lib/recruiter/jobs";
import { jobCreateSchema } from "@/lib/recruiter/validation";
import { tryEmbedJob } from "@/lib/vector-store";

// GET /api/recruiter/jobs: every job of the recruiter's company, with the
// trigger-maintained applicant_count and the per-stage counts from
// recruiter_pipeline_view (migration 013).
export const GET = withAuth({ roles: [ROLES.RECRUITER] }, async (_request, { user }) => {
  const { rows } = await query(
    `SELECT j.job_id::int AS id, j.title, j.status, j.location, j.work_mode AS "workMode",
            j.employment_type AS "employmentType", j.openings, j.posted_at AS "postedAt",
            to_char(j.closes_at, 'YYYY-MM-DD') AS "closesAt",
            j.applicant_count AS "applicantCount",
            v.recruiter_name AS "postedBy",
            v.applied::int, v.shortlisted::int, v.interviewed::int, v.offered::int, v.rejected::int,
            v.avg_match_score::float8 AS "avgMatchScore",
            EXISTS (SELECT 1 FROM job_embeddings je WHERE je.job_id = j.job_id) AS "isEmbedded"
       FROM jobs j
       JOIN recruiter_pipeline_view v ON v.job_id = j.job_id
      WHERE j.company_id = (SELECT r.company_id FROM recruiters r WHERE r.user_id = $1)
      ORDER BY CASE j.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, j.posted_at DESC, j.job_id DESC`,
    [user.id]);
  return NextResponse.json({ jobs: rows }, { headers: { "Cache-Control": "no-store" } });
});

// POST /api/recruiter/jobs: create a job for the recruiter's own company.
// company_id and recruiter_id come from the session + database, never from
// the request body (the strict schema rejects them).
export const POST = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user }) => {
  assertSameOrigin(request);
  const data = await readJsonBody(request, jobCreateSchema);
  const client = await getPool().connect();
  let jobId;
  try {
    await client.query("BEGIN");
    const recruiter = await client.query("SELECT company_id FROM recruiters WHERE user_id = $1", [user.id]);
    if (!recruiter.rowCount) throw forbidden("Your recruiter profile is not linked to a company");
    const { rows } = await client.query(
      `INSERT INTO jobs (company_id, recruiter_id, title, description, location, work_mode, employment_type,
                         salary_min, salary_max, currency, openings, min_experience_years, closes_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING job_id::int`,
      [recruiter.rows[0].company_id, user.id, data.title, data.description, data.location, data.workMode,
       data.employmentType, data.salaryMin, data.salaryMax, data.currency, data.openings,
       data.minExperienceYears, data.closesAt, data.status]);
    jobId = rows[0].job_id;
    await replaceJobSkills(client, jobId, data.skills);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  // After COMMIT, same pattern as resume uploads: the job is saved either way;
  // if the model fails it simply stays "not embedded" until db:embed.
  await tryEmbedJob(jobId);
  const job = await loadJobDetail(jobId);
  return NextResponse.json({ job }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
