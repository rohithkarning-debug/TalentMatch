import { NextResponse } from "next/server";
import { ApiError, forbidden, notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";
import { jobMatchesQuerySchema } from "@/lib/recruiter/validation";

// GET /api/recruiter/jobs/:jobId/matches?applicantsOnly=true|false&limit=N
// Candidates ranked by semantic similarity to the job, computed in the
// database by rank_candidates_for_job() (migration 015). Every score is a
// real cosine similarity between stored embeddings.
export const GET = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  const jobId = idParamSchema.safeParse(params.jobId);
  if (!jobId.success) throw notFound("Job not found");
  const options = jobMatchesQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));

  // Ownership comes from the database: the job's company and the logged-in
  // recruiter's company, never from anything the client sends.
  const { rows } = await query(
    `SELECT j.title, j.company_id, je.model_name, je.created_at AS embedded_at,
            (SELECT r.company_id FROM recruiters r WHERE r.user_id = $2) AS recruiter_company_id
       FROM jobs j
       LEFT JOIN job_embeddings je ON je.job_id = j.job_id
      WHERE j.job_id = $1`, [jobId.data, user.id]);
  if (!rows.length) throw notFound("Job not found");
  const job = rows[0];
  if (job.recruiter_company_id === null || String(job.recruiter_company_id) !== String(job.company_id)) {
    throw forbidden("You can only view matches for your own company's jobs");
  }
  if (job.model_name === null) {
    throw new ApiError(404, "NOT_EMBEDDED", "This job has no embedding yet, so it cannot be matched. Run `npm run db:embed` or save the job again.");
  }

  const matches = await query(
    `SELECT candidate_id::int AS "candidateId", full_name AS "fullName",
            years_experience::float8 AS "yearsExperience", resume_id::int AS "resumeId",
            similarity::float8 AS similarity, matched_skills AS "matchedSkills",
            required_skills AS "requiredSkills", has_applied AS "hasApplied"
       FROM rank_candidates_for_job($1, $2, $3)`,
    [jobId.data, options.limit, options.applicantsOnly]);

  return NextResponse.json({
    job: { id: jobId.data, title: job.title, embeddingModel: job.model_name, embeddedAt: job.embedded_at },
    applicantsOnly: options.applicantsOnly,
    limit: options.limit,
    matches: matches.rows,
  }, { headers: { "Cache-Control": "no-store" } });
});
