import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";

// GET /api/candidate/interviews: the candidate's own interviews, upcoming
// first. Rating and feedback are the recruiter's internal notes and are
// deliberately NOT selected.
export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (_request, { user }) => {
  const { rows } = await query(
    `SELECT i.interview_id::int AS id, i.application_id::int AS "applicationId", i.round_no AS "roundNo",
            i.scheduled_at AS "scheduledAt", i.duration_minutes AS "durationMinutes", i.mode,
            i.location_or_link AS "locationOrLink", i.status,
            (i.status = 'scheduled' AND i.scheduled_at >= now()) AS "isUpcoming",
            j.job_id::int AS "jobId", j.title AS "jobTitle", c.name AS company
       FROM interviews i
       JOIN applications a ON a.application_id = i.application_id
       JOIN jobs j         ON j.job_id = a.job_id
       JOIN companies c    ON c.company_id = j.company_id
      WHERE a.candidate_id = $1
      ORDER BY (i.status = 'scheduled' AND i.scheduled_at >= now()) DESC,
               CASE WHEN i.status = 'scheduled' AND i.scheduled_at >= now() THEN i.scheduled_at END ASC,
               i.scheduled_at DESC`, [user.id]);
  return NextResponse.json({ interviews: rows }, { headers: { "Cache-Control": "no-store" } });
});
