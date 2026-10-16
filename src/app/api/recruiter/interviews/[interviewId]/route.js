import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { updateInterview } from "@/lib/interviews";
import { idParamSchema } from "@/lib/validation/auth";
import { interviewUpdateSchema } from "@/lib/validation/pipeline";

// PATCH /api/recruiter/interviews/:interviewId
//   { action: "reschedule", scheduledAt, locationOrLink? }
//   { action: "cancel", reason? }
//   { action: "complete", rating (1-5), feedback }
// Only a 'scheduled' interview can change (trg_interviews_guard -> 409).
export const PATCH = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const interviewId = idParamSchema.safeParse(params.interviewId);
  if (!interviewId.success) throw notFound("Interview not found");
  const data = await readJsonBody(request, interviewUpdateSchema);
  const interview = await updateInterview(user, interviewId.data, data);
  return NextResponse.json({ interview }, { headers: { "Cache-Control": "no-store" } });
});
