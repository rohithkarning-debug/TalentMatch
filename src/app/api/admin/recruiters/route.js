import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { createRecruiter, listRecruiters } from "@/lib/admin/recruiters";
import { recruiterCreateSchema } from "@/lib/admin/validation";

const NO_STORE = { "Cache-Control": "no-store" };

// GET /api/admin/recruiters: every recruiter with company and workload.
export const GET = withAuth({ roles: [ROLES.ADMIN] }, async () => {
  return NextResponse.json({ recruiters: await listRecruiters() }, { headers: NO_STORE });
});

// POST /api/admin/recruiters: users + recruiters rows in ONE transaction.
export const POST = withAuth({ roles: [ROLES.ADMIN] }, async (request) => {
  assertSameOrigin(request);
  const data = await readJsonBody(request, recruiterCreateSchema);
  return NextResponse.json({ recruiter: await createRecruiter(data) }, { status: 201, headers: NO_STORE });
});
