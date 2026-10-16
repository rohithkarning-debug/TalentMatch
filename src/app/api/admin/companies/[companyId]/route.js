import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api/errors";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { deleteCompany, getCompany, updateCompany } from "@/lib/admin/companies";
import { companyUpdateSchema } from "@/lib/admin/validation";
import { idParamSchema } from "@/lib/validation/auth";

const NO_STORE = { "Cache-Control": "no-store" };

function companyId(params) {
  const parsed = idParamSchema.safeParse(params.companyId);
  if (!parsed.success) throw badRequest("Company id must be a positive integer");
  return parsed.data;
}

// GET /api/admin/companies/:companyId
export const GET = withAuth({ roles: [ROLES.ADMIN] }, async (_request, { params }) => {
  return NextResponse.json({ company: await getCompany(companyId(params)) }, { headers: NO_STORE });
});

// PATCH /api/admin/companies/:companyId: change any subset of the fields.
export const PATCH = withAuth({ roles: [ROLES.ADMIN] }, async (request, { params }) => {
  assertSameOrigin(request);
  const id = companyId(params);
  const data = await readJsonBody(request, companyUpdateSchema);
  return NextResponse.json({ company: await updateCompany(id, data) }, { headers: NO_STORE });
});

// DELETE /api/admin/companies/:companyId
// 409 COMPANY_IN_USE when the ON DELETE RESTRICT foreign keys refuse.
export const DELETE = withAuth({ roles: [ROLES.ADMIN] }, async (request, { params }) => {
  assertSameOrigin(request);
  return NextResponse.json({ deleted: await deleteCompany(companyId(params)) }, { headers: NO_STORE });
});
