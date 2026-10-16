import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { withdrawOffer } from "@/lib/offers";
import { idParamSchema } from "@/lib/validation/auth";

// POST /api/recruiter/offers/:offerId/withdraw
// Pending offer -> 'withdrawn' and application offered -> rejected, with a
// candidate notification, in one transaction. Not pending -> 409.
export const POST = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const offerId = idParamSchema.safeParse(params.offerId);
  if (!offerId.success) throw notFound("Offer not found");
  const offer = await withdrawOffer(user, offerId.data);
  return NextResponse.json({ offer }, { headers: { "Cache-Control": "no-store" } });
});
