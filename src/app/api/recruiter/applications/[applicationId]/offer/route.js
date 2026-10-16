import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { makeOffer } from "@/lib/offers";
import { idParamSchema } from "@/lib/validation/auth";
import { offerCreateSchema } from "@/lib/validation/pipeline";

// POST /api/recruiter/applications/:applicationId/offer
//   { salaryOffered, currency?, joiningDate, expiresOn }
// One transaction: application -> 'offered' + offer row + notification.
// Only an 'interviewed' application can move to 'offered' (DB trigger);
// a second offer hits UNIQUE (application_id) -> 409 OFFER_EXISTS.
export const POST = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const applicationId = idParamSchema.safeParse(params.applicationId);
  if (!applicationId.success) throw notFound("Application not found");
  const data = await readJsonBody(request, offerCreateSchema);
  const offer = await makeOffer(user, applicationId.data, data);
  return NextResponse.json({ offer }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
