import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { ApiError, forbidden, notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";
import { applicationStatusSchema } from "@/lib/recruiter/validation";

// PATCH /api/recruiter/applications/:applicationId { status, note? }
// Moves an application through the pipeline by calling the stored function
// update_application_status() (migration 012). The API does not re-implement
// the workflow: the BEFORE UPDATE trigger trg_applications_status_guard rejects
// invalid transitions and the AFTER trigger writes the history row.
export const PATCH = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const applicationId = idParamSchema.safeParse(params.applicationId);
  if (!applicationId.success) throw notFound("Application not found");
  const data = await readJsonBody(request, applicationStatusSchema);

  // API-level ownership check (the function checks again inside the DB).
  const owner = await query(
    `SELECT j.company_id, (SELECT r.company_id FROM recruiters r WHERE r.user_id = $2) AS recruiter_company_id
       FROM applications a JOIN jobs j ON j.job_id = a.job_id
      WHERE a.application_id = $1`, [applicationId.data, user.id]);
  if (!owner.rowCount) throw notFound("Application not found");
  const { company_id: companyId, recruiter_company_id: recruiterCompanyId } = owner.rows[0];
  if (recruiterCompanyId === null || String(recruiterCompanyId) !== String(companyId)) {
    throw forbidden("You can only update applications for your own company's jobs");
  }

  let updated;
  try {
    const { rows } = await query(
      `SELECT application_id::int AS id, status, match_score::float8 AS "matchScore", updated_at AS "updatedAt"
         FROM update_application_status($1, $2, $3, $4)`,
      [applicationId.data, data.status, user.id, data.note || null]);
    updated = rows[0];
  } catch (err) {
    // RAISE EXCEPTION from the transition guard trigger. The message is our
    // own text ("Invalid application status transition: rejected -> offered"),
    // so it is safe and useful to show it to the recruiter.
    if (err?.code === "23514" && /Invalid application status transition/.test(err.message)) {
      throw new ApiError(409, "INVALID_TRANSITION", err.message, { hint: err.hint });
    }
    if (err?.code === "42501") throw forbidden("You can only update applications for your own company's jobs");
    throw err;
  }
  return NextResponse.json({ application: updated }, { headers: { "Cache-Control": "no-store" } });
});
