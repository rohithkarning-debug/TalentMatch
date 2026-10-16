import { ApiError, badRequest, notFound } from "../api/api-error.js";
import { hashPassword } from "../auth/password.js";
import { getPool, query as defaultQuery } from "../db.js";

// Recruiter account management (admin only).

const RECRUITER_COLUMNS = `
  u.user_id::int AS id, u.full_name AS "fullName", u.email, u.is_active AS "isActive",
  u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
  r.company_id::int AS "companyId", c.name AS "companyName", r.designation, r.phone`;

// Workload per recruiter comes from recruiter_pipeline_view (one row per job),
// aggregated again with GROUP BY recruiter_id.
export async function listRecruiters({ query = defaultQuery } = {}) {
  const { rows } = await query(
    `SELECT ${RECRUITER_COLUMNS},
            coalesce(w.jobs, 0)::int AS "jobCount",
            coalesce(w.open_jobs, 0)::int AS "openJobCount",
            coalesce(w.active_in_pipeline, 0)::int AS "activeInPipeline"
       FROM recruiters r
       JOIN users u     ON u.user_id = r.user_id
       JOIN companies c ON c.company_id = r.company_id
       LEFT JOIN (
            SELECT recruiter_id,
                   count(*) AS jobs,
                   count(*) FILTER (WHERE job_status = 'open') AS open_jobs,
                   sum(active_in_pipeline) AS active_in_pipeline
              FROM recruiter_pipeline_view
             WHERE recruiter_id IS NOT NULL
             GROUP BY recruiter_id
       ) w ON w.recruiter_id = r.user_id
      ORDER BY u.is_active DESC, c.name, u.full_name`);
  return rows;
}

export async function getRecruiter(userId, { query = defaultQuery } = {}) {
  const { rows } = await query(
    `SELECT ${RECRUITER_COLUMNS}
       FROM recruiters r JOIN users u ON u.user_id = r.user_id JOIN companies c ON c.company_id = r.company_id
      WHERE r.user_id = $1`, [userId]);
  if (!rows[0]) throw notFound("Recruiter not found");
  return rows[0];
}

function translate(err) {
  if (err instanceof ApiError) return err;
  if (err?.code === "23505" && err?.constraint === "users_email_key") {
    return new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
  }
  if (err?.code === "23503" && err?.constraint === "recruiters_company_fkey") {
    return badRequest("The selected company does not exist", { constraint: err.constraint });
  }
  return err;
}

// Create a recruiter account = TWO inserts that must succeed together:
//
//   BEGIN
//     INSERT INTO users (..., role = 'recruiter')   -> new user_id
//     INSERT INTO recruiters (user_id, company_id)  -> FK to users AND companies
//   COMMIT
//
// If the second insert fails (e.g. the company does not exist), ROLLBACK
// removes the users row too, so there is never a "recruiter" login without a
// recruiter profile. The password is hashed BEFORE the transaction starts so
// the slow bcrypt step does not hold a database connection open.
//
// afterUserInsert(client, userId) is a test hook only: it lets a test check
// the row exists inside the transaction and then force a failure.
export async function createRecruiter(data, { pool = getPool(), afterUserInsert } = {}) {
  const passwordHash = await hashPassword(data.password);
  const client = await pool.connect();
  let userId;
  try {
    await client.query("BEGIN");
    const user = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'recruiter')
       RETURNING user_id::int`,
      [data.email, passwordHash, data.fullName]);
    userId = user.rows[0].user_id;
    if (afterUserInsert) await afterUserInsert(client, userId);
    await client.query(
      `INSERT INTO recruiters (user_id, company_id, designation, phone) VALUES ($1, $2, $3, $4)`,
      [userId, data.companyId, data.designation, data.phone]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw translate(err);
  } finally {
    client.release();
  }
  return getRecruiter(userId, { query: (t, p) => pool.query(t, p) });
}

// Edit name / company / designation / phone, or (de)activate. users and
// recruiters are updated in one transaction.
//
// Deactivating needs no session bookkeeping: loadSessionUser() re-reads
// users.is_active on every request, so the recruiter's existing cookie stops
// working on their next request, and login refuses inactive accounts.
//
// Moving a recruiter to another company is blocked by the database while they
// still own jobs at the old company: jobs (recruiter_id, company_id) is a
// composite FK to recruiters (user_id, company_id), so a recruiter can only
// own jobs of their own company.
export async function updateRecruiter(userId, data, { pool = getPool() } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT r.user_id FROM recruiters r WHERE r.user_id = $1 FOR UPDATE", [userId]);
    if (!current.rowCount) throw notFound("Recruiter not found");

    if (data.fullName !== undefined || data.isActive !== undefined) {
      await client.query(
        `UPDATE users SET full_name = coalesce($2, full_name), is_active = coalesce($3, is_active)
          WHERE user_id = $1 AND role = 'recruiter'`,
        [userId, data.fullName ?? null, data.isActive ?? null]);
    }
    const profile = { company_id: data.companyId, designation: data.designation, phone: data.phone };
    const fields = Object.keys(profile).filter((k) => profile[k] !== undefined);
    if (fields.length) {
      await client.query(
        `UPDATE recruiters SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE user_id = $1`,
        [userId, ...fields.map((k) => profile[k])]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23503" && err?.constraint === "jobs_recruiter_fkey") {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n, min(c.name) AS company
           FROM jobs j JOIN companies c ON c.company_id = j.company_id WHERE j.recruiter_id = $1`, [userId]);
      throw new ApiError(409, "RECRUITER_OWNS_JOBS",
        `This recruiter still owns ${rows[0].n} job${rows[0].n === 1 ? "" : "s"} at ${rows[0].company}, ` +
        "so they cannot move to another company. A recruiter can only own jobs of their own company.",
        { constraint: err.constraint });
    }
    throw translate(err);
  } finally {
    client.release();
  }
  return getRecruiter(userId, { query: (t, p) => pool.query(t, p) });
}
