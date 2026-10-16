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

  // The ranking itself comes unchanged from the function (its ORDER BY is
  // kept via WITH ORDINALITY). The extra columns only describe each row:
  // skill names behind the matched/required counts, and the application (if
  // the candidate applied) so the UI can link to it.
  const matches = await query(
    `SELECT m.candidate_id::int AS "candidateId", m.full_name AS "fullName",
            m.years_experience::float8 AS "yearsExperience", m.resume_id::int AS "resumeId",
            m.similarity::float8 AS similarity, m.matched_skills AS "matchedSkills",
            m.required_skills AS "requiredSkills", m.has_applied AS "hasApplied",
            COALESCE((SELECT array_agg(s.name ORDER BY s.name)
                        FROM job_skills js
                        JOIN skills s ON s.skill_id = js.skill_id
                        JOIN candidate_skills cs ON cs.skill_id = js.skill_id AND cs.candidate_id = m.candidate_id
                       WHERE js.job_id = $1 AND js.is_required
                         AND cs.proficiency >= js.min_proficiency), '{}') AS "matchedSkillNames",
            a.application_id::int AS "applicationId", a.status AS "applicationStatus"
       FROM rank_candidates_for_job($1, $2, $3) WITH ORDINALITY AS m
       LEFT JOIN applications a ON a.job_id = $1 AND a.candidate_id = m.candidate_id
      ORDER BY m.ordinality`,
    [jobId.data, options.limit, options.applicantsOnly]);
  const required = await query(
    `SELECT COALESCE(array_agg(s.name ORDER BY s.name), '{}') AS names
       FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
      WHERE js.job_id = $1 AND js.is_required`, [jobId.data]);

  return NextResponse.json({
    job: { id: jobId.data, title: job.title, embeddingModel: job.model_name, embeddedAt: job.embedded_at,
           requiredSkills: required.rows[0].names },
    applicantsOnly: options.applicantsOnly,
    limit: options.limit,
    matches: matches.rows,
  }, { headers: { "Cache-Control": "no-store" } });
});
