import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { scheduleInterview } from "@/lib/interviews";
import { idParamSchema } from "@/lib/validation/auth";
import { interviewScheduleSchema } from "@/lib/validation/pipeline";

// POST /api/recruiter/applications/:applicationId/interviews
//   { scheduledAt, durationMinutes?, mode, locationOrLink? }
// Schedules the next round. The first one also moves the application to
// 'interviewed', in the same transaction (src/lib/interviews.js).
export const POST = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const applicationId = idParamSchema.safeParse(params.applicationId);
  if (!applicationId.success) throw notFound("Application not found");
  const data = await readJsonBody(request, interviewScheduleSchema);
  const result = await scheduleInterview(user, applicationId.data, data);
  return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
});
