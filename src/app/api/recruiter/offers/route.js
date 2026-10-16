import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";

// GET /api/recruiter/offers: every offer for jobs of the recruiter's company.
// isExpired uses local_today() (India), the same rule as trg_offers_guard.
export const GET = withAuth({ roles: [ROLES.RECRUITER] }, async (_request, { user }) => {
  const { rows } = await query(
    `SELECT o.offer_id::int AS id, o.application_id::int AS "applicationId",
            o.salary_offered::float8 AS "salaryOffered", o.currency, o.joining_date::text AS "joiningDate",
            o.expires_on::text AS "expiresOn", o.status, o.offered_at AS "offeredAt", o.responded_at AS "respondedAt",
            (o.expires_on < local_today()) AS "isExpired",
            a.status AS "applicationStatus", j.job_id::int AS "jobId", j.title AS "jobTitle",
            u.full_name AS "candidateName"
       FROM offers o
       JOIN applications a ON a.application_id = o.application_id
       JOIN jobs j         ON j.job_id = a.job_id
       JOIN users u        ON u.user_id = a.candidate_id
      WHERE j.company_id = (SELECT r.company_id FROM recruiters r WHERE r.user_id = $1)
      ORDER BY (o.status = 'pending') DESC, o.offered_at DESC`, [user.id]);
  return NextResponse.json({ offers: rows }, { headers: { "Cache-Control": "no-store" } });
});
