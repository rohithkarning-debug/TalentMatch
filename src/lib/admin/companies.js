import { ApiError, notFound } from "../api/api-error.js";
import { query as defaultQuery } from "../db.js";

// Company management (admin only). Plain parameterized SQL.

const COMPANY_COLUMNS = `
  c.company_id::int AS id, c.name, c.industry, c.location, c.website, c.description,
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;

// Each count is a correlated subquery, not a JOIN: joining recruiters AND jobs
// in one FROM would multiply rows (recruiters × jobs) and inflate the counts.
export async function listCompanies({ query = defaultQuery } = {}) {
  const { rows } = await query(
    `SELECT ${COMPANY_COLUMNS},
            (SELECT count(*)::int FROM recruiters r WHERE r.company_id = c.company_id) AS "recruiterCount",
            (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.company_id) AS "jobCount",
            (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.company_id AND j.status = 'open') AS "openJobCount",
            (SELECT count(*)::int FROM applications a JOIN jobs j ON j.job_id = a.job_id
              WHERE j.company_id = c.company_id) AS "applicationCount"
       FROM companies c
      ORDER BY c.name`);
  return rows;
}

export async function getCompany(companyId, { query = defaultQuery } = {}) {
  const { rows } = await query(`SELECT ${COMPANY_COLUMNS} FROM companies c WHERE c.company_id = $1`, [companyId]);
  if (!rows[0]) throw notFound("Company not found");
  return rows[0];
}

function translate(err) {
  if (err?.code === "23505" && err?.constraint === "companies_name_key") {
    return new ApiError(409, "COMPANY_NAME_TAKEN", "A company with this name already exists");
  }
  return err;
}

export async function createCompany(data, { query = defaultQuery } = {}) {
  try {
    const { rows } = await query(
      `INSERT INTO companies AS c (name, industry, location, website, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COMPANY_COLUMNS}`,
      [data.name, data.industry, data.location, data.website, data.description]);
    return rows[0];
  } catch (err) { throw translate(err); }
}

// Only the fields that were sent are changed. Column names come from this
// fixed map, never from the request, so the dynamic SET list is still safe;
// every value is a $n parameter.
const COLUMN_FOR = { name: "name", industry: "industry", location: "location", website: "website", description: "description" };

export async function updateCompany(companyId, data, { query = defaultQuery } = {}) {
  const fields = Object.keys(data).filter((k) => COLUMN_FOR[k]);
  const sets = fields.map((k, i) => `${COLUMN_FOR[k]} = $${i + 2}`);
  try {
    const { rows } = await query(
      `UPDATE companies AS c SET ${sets.join(", ")} WHERE c.company_id = $1 RETURNING ${COMPANY_COLUMNS}`,
      [companyId, ...fields.map((k) => data[k])]);
    if (!rows[0]) throw notFound("Company not found");
    return rows[0];
  } catch (err) { throw translate(err); }
}

// The DELETE is sent as is. We deliberately do NOT check for recruiters/jobs
// first: the foreign keys recruiters_company_fkey and jobs_company_fkey are
// ON DELETE RESTRICT, so PostgreSQL itself refuses (error 23503). We only
// translate that refusal into a readable 409 with the counts.
export async function deleteCompany(companyId, { query = defaultQuery } = {}) {
  try {
    const { rows } = await query("DELETE FROM companies WHERE company_id = $1 RETURNING name", [companyId]);
    if (!rows[0]) throw notFound("Company not found");
    return { id: companyId, name: rows[0].name };
  } catch (err) {
    if (err?.code !== "23503") throw err;
    const { rows } = await query(
      `SELECT c.name,
              (SELECT count(*)::int FROM recruiters r WHERE r.company_id = c.company_id) AS recruiters,
              (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.company_id) AS jobs
         FROM companies c WHERE c.company_id = $1`, [companyId]);
    const c = rows[0] || { name: "This company", recruiters: 0, jobs: 0 };
    const parts = [];
    if (c.recruiters) parts.push(`${c.recruiters} recruiter${c.recruiters === 1 ? "" : "s"}`);
    if (c.jobs) parts.push(`${c.jobs} job${c.jobs === 1 ? "" : "s"}`);
    throw new ApiError(409, "COMPANY_IN_USE",
      `${c.name} cannot be deleted because it still has ${parts.join(" and ") || "linked records"}. ` +
      "Move or remove them first.",
      { constraint: err.constraint, recruiters: c.recruiters, jobs: c.jobs });
  }
}
