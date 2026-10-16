import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";
import { assertJobInRecruiterCompany } from "@/lib/recruiter/jobs";

// GET /api/recruiter/jobs/:jobId/applications: every applicant of the job,
// ranked by applications.match_score (cosine similarity of the resume they
// APPLIED WITH vs the job, set by the apply transaction). Applicants without
// a score (not embedded yet) are listed last, never hidden.
// Each row carries matched vs required skills, the status history, its
// interviews (by round) and its offer (at most one: UNIQUE application_id).
export const GET = withAuth({ roles: [ROLES.RECRUITER] }, async (_request, { user, params }) => {
  const jobId = idParamSchema.safeParse(params.jobId);
  if (!jobId.success) throw notFound("Job not found");
  await assertJobInRecruiterCompany(jobId.data, user);

  const { rows } = await query(
    `SELECT a.application_id::int AS id, a.candidate_id::int AS "candidateId", u.full_name AS "fullName",
            c.headline, c.years_experience::float8 AS "yearsExperience", a.status,
            a.match_score::float8 AS "matchScore", a.applied_at AS "appliedAt", a.updated_at AS "updatedAt",
            a.cover_letter AS "coverLetter", r.file_name AS "resumeFileName",
            COALESCE((SELECT array_agg(s.name ORDER BY s.name)
                        FROM job_skills js
                        JOIN skills s ON s.skill_id = js.skill_id
                        JOIN candidate_skills cs ON cs.skill_id = js.skill_id AND cs.candidate_id = a.candidate_id
                       WHERE js.job_id = a.job_id AND js.is_required
                         AND cs.proficiency >= js.min_proficiency), '{}') AS "matchedSkills",
            COALESCE((SELECT array_agg(s.name ORDER BY s.name)
                        FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
                       WHERE js.job_id = a.job_id AND js.is_required), '{}') AS "requiredSkills",
            COALESCE((SELECT json_agg(json_build_object(
                         'oldStatus', h.old_status, 'newStatus', h.new_status, 'note', h.note,
                         'changedAt', h.changed_at, 'changedBy', cu.full_name)
                       ORDER BY h.changed_at, h.history_id)
                        FROM application_status_history h
                        LEFT JOIN users cu ON cu.user_id = h.changed_by
                       WHERE h.application_id = a.application_id), '[]') AS history,
            COALESCE((SELECT json_agg(json_build_object(
                         'id', i.interview_id, 'roundNo', i.round_no, 'scheduledAt', i.scheduled_at,
                         'mode', i.mode, 'status', i.status, 'rating', i.rating)
                       ORDER BY i.round_no)
                        FROM interviews i
                       WHERE i.application_id = a.application_id), '[]') AS interviews,
            (SELECT json_build_object(
                      'id', o.offer_id, 'status', o.status, 'salaryOffered', o.salary_offered,
                      'currency', o.currency, 'joiningDate', o.joining_date, 'expiresOn', o.expires_on)
               FROM offers o WHERE o.application_id = a.application_id) AS offer
       FROM applications a
       JOIN users u      ON u.user_id = a.candidate_id
       JOIN candidates c ON c.user_id = a.candidate_id
       LEFT JOIN resumes r ON r.resume_id = a.resume_id
      WHERE a.job_id = $1
      ORDER BY a.match_score DESC NULLS LAST, a.applied_at, a.application_id`, [jobId.data]);
  return NextResponse.json({ applications: rows }, { headers: { "Cache-Control": "no-store" } });
});
