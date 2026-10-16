import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";

// GET /api/candidate/offers: the candidate's own offers. canRespond mirrors
// the rules of trg_offers_guard (pending, not expired, application still
// 'offered') so the page only shows Accept/Decline when they would work;
// the database still decides when the button is pressed.
export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (_request, { user }) => {
  const { rows } = await query(
    `SELECT o.offer_id::int AS id, o.application_id::int AS "applicationId",
            o.salary_offered::float8 AS "salaryOffered", o.currency, o.joining_date::text AS "joiningDate",
            o.expires_on::text AS "expiresOn", o.status, o.offered_at AS "offeredAt", o.responded_at AS "respondedAt",
            (o.expires_on < local_today()) AS "isExpired",
            (o.status = 'pending' AND a.status = 'offered'
             AND (o.expires_on IS NULL OR o.expires_on >= local_today())) AS "canRespond",
            j.job_id::int AS "jobId", j.title AS "jobTitle", j.location, c.name AS company
       FROM offers o
       JOIN applications a ON a.application_id = o.application_id
       JOIN jobs j         ON j.job_id = a.job_id
       JOIN companies c    ON c.company_id = j.company_id
      WHERE a.candidate_id = $1
      ORDER BY (o.status = 'pending') DESC, o.offered_at DESC`, [user.id]);
  return NextResponse.json({ offers: rows }, { headers: { "Cache-Control": "no-store" } });
});
