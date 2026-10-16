import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { respondToOffer } from "@/lib/offers";
import { idParamSchema } from "@/lib/validation/auth";
import { offerResponseSchema } from "@/lib/validation/pipeline";

// POST /api/candidate/offers/:offerId/respond { decision: "accept" | "decline" }
// Someone else's offer -> 404. Expired / not pending -> 409 (trg_offers_guard).
export const POST = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const offerId = idParamSchema.safeParse(params.offerId);
  if (!offerId.success) throw notFound("Offer not found");
  const { decision } = await readJsonBody(request, offerResponseSchema);
  const offer = await respondToOffer(user.id, offerId.data, decision);
  return NextResponse.json({ offer }, { headers: { "Cache-Control": "no-store" } });
});
