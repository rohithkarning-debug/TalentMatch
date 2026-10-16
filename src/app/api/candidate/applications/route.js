import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { applyToJob } from "@/lib/applications";
import { applicationCreateSchema } from "@/lib/candidate/validation";

// GET /api/candidate/applications: the candidate's own applications from
// candidate_application_view (migration 013), each with its full status
// history (written by trg_applications_status_history).
export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (_request, { user }) => {
  const { rows } = await query(
    `SELECT v.application_id::int AS id, v.job_id::int AS "jobId", v.job_title AS "jobTitle",
            v.job_status AS "jobStatus", v.company_name AS company, v.job_location AS location,
            v.work_mode AS "workMode", v.application_status AS status,
            v.match_score::float8 AS "matchScore", v.applied_at AS "appliedAt",
            v.status_changed_at AS "statusChangedAt", v.next_interview_at AS "nextInterviewAt",
            v.offer_status AS "offerStatus", r.file_name AS "resumeFileName",
            COALESCE((SELECT json_agg(json_build_object(
                         'oldStatus', h.old_status, 'newStatus', h.new_status,
                         'note', h.note, 'changedAt', h.changed_at)
                       ORDER BY h.changed_at, h.history_id)
                        FROM application_status_history h
                       WHERE h.application_id = v.application_id), '[]') AS history
       FROM candidate_application_view v
       JOIN applications a ON a.application_id = v.application_id
       LEFT JOIN resumes r ON r.resume_id = a.resume_id
      WHERE v.candidate_id = $1
      ORDER BY v.applied_at DESC, v.application_id DESC`, [user.id]);
  return NextResponse.json({ applications: rows }, { headers: { "Cache-Control": "no-store" } });
});

// POST /api/candidate/applications { jobId, resumeId, coverLetter? }
// Runs the apply transaction in src/lib/applications.js.
export const POST = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user }) => {
  assertSameOrigin(request);
  const data = await readJsonBody(request, applicationCreateSchema);
  const application = await applyToJob({ candidateId: user.id, ...data });
  return NextResponse.json({ application }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
