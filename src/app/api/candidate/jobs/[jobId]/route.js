import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";
import { getSkillGap } from "@/lib/candidate/skill-gap";

// GET /api/candidate/jobs/:jobId: one job for the job page: details, the
// candidate's skill gap, and their application if they already applied.
// Visible if it is open, or if the candidate applied before it closed.
// Drafts are never visible to candidates.
export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (_request, { user, params }) => {
  const jobId = idParamSchema.safeParse(params.jobId);
  if (!jobId.success) throw notFound("Job not found");

  const { rows } = await query(
    `SELECT j.job_id::int AS id, j.title, c.name AS company, c.industry, j.location,
            j.work_mode AS "workMode", j.employment_type AS "employmentType",
            j.min_experience_years::float8 AS "minExperienceYears",
            j.salary_min::float8 AS "salaryMin", j.salary_max::float8 AS "salaryMax", j.currency,
            j.openings, j.status, j.posted_at AS "postedAt", to_char(j.closes_at, 'YYYY-MM-DD') AS "closesAt",
            j.description,
            COALESCE((SELECT json_agg(json_build_object('name', s.name, 'isRequired', js.is_required,
                                                        'minProficiency', js.min_proficiency)
                                      ORDER BY js.is_required DESC, s.name)
                        FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
                       WHERE js.job_id = j.job_id), '[]') AS skills,
            (SELECT json_build_object('id', a.application_id, 'status', a.status,
                                      'matchScore', a.match_score::float8, 'appliedAt', a.applied_at)
               FROM applications a
              WHERE a.job_id = j.job_id AND a.candidate_id = $2) AS application
       FROM jobs j
       JOIN companies c ON c.company_id = j.company_id
      WHERE j.job_id = $1
        AND (j.status = 'open'
             OR (j.status = 'closed' AND EXISTS (SELECT 1 FROM applications a
                                                  WHERE a.job_id = j.job_id AND a.candidate_id = $2)))`,
    [jobId.data, user.id]);
  if (!rows.length) throw notFound("Job not found");

  const skillGap = await getSkillGap(jobId.data, user.id);
  return NextResponse.json({ job: rows[0], skillGap }, { headers: { "Cache-Control": "no-store" } });
});
