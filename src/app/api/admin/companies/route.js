import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { createCompany, listCompanies } from "@/lib/admin/companies";
import { companyCreateSchema } from "@/lib/admin/validation";

const NO_STORE = { "Cache-Control": "no-store" };

// GET /api/admin/companies: every company with recruiter / job / application counts.
export const GET = withAuth({ roles: [ROLES.ADMIN] }, async () => {
  return NextResponse.json({ companies: await listCompanies() }, { headers: NO_STORE });
});

// POST /api/admin/companies
export const POST = withAuth({ roles: [ROLES.ADMIN] }, async (request) => {
  assertSameOrigin(request);
  const data = await readJsonBody(request, companyCreateSchema);
  return NextResponse.json({ company: await createCompany(data) }, { status: 201, headers: NO_STORE });
});
