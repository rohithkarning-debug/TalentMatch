import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api/errors";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { getRecruiter, updateRecruiter } from "@/lib/admin/recruiters";
import { recruiterUpdateSchema } from "@/lib/admin/validation";
import { idParamSchema } from "@/lib/validation/auth";

const NO_STORE = { "Cache-Control": "no-store" };

function recruiterId(params) {
  const parsed = idParamSchema.safeParse(params.recruiterId);
  if (!parsed.success) throw badRequest("Recruiter id must be a positive integer");
  return parsed.data;
}

// GET /api/admin/recruiters/:recruiterId
export const GET = withAuth({ roles: [ROLES.ADMIN] }, async (_request, { params }) => {
  return NextResponse.json({ recruiter: await getRecruiter(recruiterId(params)) }, { headers: NO_STORE });
});

// PATCH /api/admin/recruiters/:recruiterId
// { fullName?, companyId?, designation?, phone?, isActive? }
export const PATCH = withAuth({ roles: [ROLES.ADMIN] }, async (request, { params }) => {
  assertSameOrigin(request);
  const id = recruiterId(params);
  const data = await readJsonBody(request, recruiterUpdateSchema);
  return NextResponse.json({ recruiter: await updateRecruiter(id, data) }, { headers: NO_STORE });
});
