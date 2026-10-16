import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { interviewListQuerySchema } from "@/lib/validation/pipeline";

// GET /api/recruiter/interviews?scope=upcoming|past|all
// Every interview for jobs of the recruiter's company. "Upcoming" means
// still scheduled and in the future; everything else is "past" (including
// a scheduled interview whose time has passed: it waits to be completed).
export const GET = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user }) => {
  const { scope } = interviewListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));

  const { rows } = await query(
    `SELECT i.interview_id::int AS id, i.application_id::int AS "applicationId", i.round_no AS "roundNo",
            i.scheduled_at AS "scheduledAt", i.duration_minutes AS "durationMinutes", i.mode,
            i.location_or_link AS "locationOrLink", i.status, i.rating, i.feedback,
            (i.status = 'scheduled' AND i.scheduled_at >= now()) AS "isUpcoming",
            a.status AS "applicationStatus", j.job_id::int AS "jobId", j.title AS "jobTitle",
            cu.full_name AS "candidateName", iu.full_name AS "interviewerName"
       FROM interviews i
       JOIN applications a ON a.application_id = i.application_id
       JOIN jobs j         ON j.job_id = a.job_id
       JOIN users cu       ON cu.user_id = a.candidate_id
       LEFT JOIN users iu  ON iu.user_id = i.interviewer_id
      WHERE j.company_id = (SELECT r.company_id FROM recruiters r WHERE r.user_id = $1)
        AND ($2 = 'all'
             OR ($2 = 'upcoming' AND i.status = 'scheduled' AND i.scheduled_at >= now())
             OR ($2 = 'past' AND NOT (i.status = 'scheduled' AND i.scheduled_at >= now())))
      ORDER BY (i.status = 'scheduled' AND i.scheduled_at >= now()) DESC,
               CASE WHEN i.status = 'scheduled' AND i.scheduled_at >= now() THEN i.scheduled_at END ASC,
               i.scheduled_at DESC`, [user.id, scope]);
  return NextResponse.json({ interviews: rows }, { headers: { "Cache-Control": "no-store" } });
});
