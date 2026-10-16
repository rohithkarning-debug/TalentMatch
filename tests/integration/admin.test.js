// Stage 8: admin module (companies, recruiter accounts, analytics dashboard)
// against the production Next.js server and the real database.
//
// Test data: companies named "Admin Test <run> ..." and accounts
// admin.test.<run>.*@test.example, all removed in after().
// Seeded rows are only read, never changed.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
process.env.TEST_PORT = "3103";
const { makeClient, startServer } = await import("./helpers.js");
const { createRecruiter } = await import("../../src/lib/admin/recruiters.js");
const { getPool } = await import("../../src/lib/db.js");

const RUN = Date.now().toString(36);
const DEMO_PASSWORD = "TalentMatch@2026";
const NEW_PASSWORD = "Recruit3rPass";
const COMPANY_PREFIX = `Admin Test ${RUN}`;
const EMAIL_PATTERN = `admin.test.${RUN}.%@test.example`;
let counter = 0;
const testEmail = (tag) => `admin.test.${RUN}.${tag}${++counter}@test.example`;

let server, api, db, admin, recruiter, candidate;

async function login(email, password = DEMO_PASSWORD) {
  const r = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.sessionCookie.value;
}

async function createCompany(suffix, extra = {}) {
  const r = await api("/api/admin/companies", { method: "POST", cookie: admin, json: { name: `${COMPANY_PREFIX} ${suffix}`, ...extra } });
  assert.equal(r.status, 201, r.text);
  return r.body.company;
}

async function newRecruiter(companyId, tag = "r") {
  const email = testEmail(tag);
  const r = await api("/api/admin/recruiters", { method: "POST", cookie: admin,
    json: { fullName: "Admin Test Recruiter", email, password: NEW_PASSWORD, companyId, designation: "Recruiter" } });
  assert.equal(r.status, 201, r.text);
  return { ...r.body.recruiter, email };
}

const userRows = async (email) => (await db.query("SELECT * FROM users WHERE email = $1", [email])).rows;

before(async () => {
  assert.ok(process.env.AUTH_JWT_SECRET && process.env.DATABASE_URL, "Set .env.local before integration tests");
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  server = await startServer();
  api = makeClient(server.baseUrl);
  admin = await login("admin@talentmatch.example");
  recruiter = await login("meera.iyer@nimbusanalytics.example");
  candidate = await login("aditi.sharma@mail.example");
});

after(async () => {
  // Users first (cascades to recruiters), then jobs of test companies, then the companies.
  await db?.query("DELETE FROM users WHERE email LIKE $1", [EMAIL_PATTERN]);
  await db?.query("DELETE FROM jobs WHERE company_id IN (SELECT company_id FROM companies WHERE name LIKE $1)", [`${COMPANY_PREFIX}%`]);
  await db?.query("DELETE FROM companies WHERE name LIKE $1", [`${COMPANY_PREFIX}%`]);
  await db?.end();
  await getPool().end();
  await server?.stop();
});

// ---------------------------------------------------------------- RBAC ----
const ADMIN_ROUTES = [
  ["GET", "/api/admin/dashboard"],
  ["GET", "/api/admin/companies"],
  ["POST", "/api/admin/companies", { name: "Should Never Exist" }],
  ["GET", "/api/admin/companies/1"],
  ["PATCH", "/api/admin/companies/1", { name: "Hacked" }],
  ["DELETE", "/api/admin/companies/1"],
  ["GET", "/api/admin/recruiters"],
  ["POST", "/api/admin/recruiters", { fullName: "X", email: "x@test.example", password: "Abcdefg123", companyId: 1 }],
  ["GET", "/api/admin/recruiters/2"],
  ["PATCH", "/api/admin/recruiters/2", { isActive: false }],
];

describe("admin routes enforce the admin role on the server", () => {
  it("no cookie gets 401 on every admin route", async () => {
    for (const [method, path, json] of ADMIN_ROUTES) {
      const r = await api(path, { method, json });
      assert.equal(r.status, 401, `${method} ${path}: ${r.text}`);
    }
  });

  it("recruiters and candidates get 403 on every admin route, and nothing changes", async () => {
    const before = await db.query("SELECT name FROM companies WHERE company_id = 1");
    for (const [role, cookie] of [["recruiter", recruiter], ["candidate", candidate]]) {
      for (const [method, path, json] of ADMIN_ROUTES) {
        const r = await api(path, { method, json, cookie });
        assert.equal(r.status, 403, `${role} ${method} ${path}: ${r.text}`);
        assert.equal(r.body.error.code, "FORBIDDEN");
      }
    }
    const afterRows = await db.query("SELECT name FROM companies WHERE company_id = 1");
    assert.deepEqual(afterRows.rows, before.rows);
    assert.equal((await db.query("SELECT is_active FROM users WHERE user_id = 2")).rows[0].is_active, true);
    assert.equal((await userRows("x@test.example")).length, 0);
  });

  it("admin gets 200", async () => {
    for (const path of ["/api/admin/dashboard", "/api/admin/companies", "/api/admin/recruiters"]) {
      assert.equal((await api(path, { cookie: admin })).status, 200, path);
    }
  });
});

// ----------------------------------------------------------- companies ----
describe("company management", () => {
  let company;

  it("creates a company (201) and validates input", async () => {
    company = await createCompany("Alpha", { industry: "Testing", location: "Mysuru, Karnataka", website: "https://alpha.example", description: "" });
    assert.equal(company.industry, "Testing");
    assert.equal(company.description, null, "empty text is stored as NULL");
    const { rows } = await db.query("SELECT name, website FROM companies WHERE company_id = $1", [company.id]);
    assert.deepEqual(rows[0], { name: `${COMPANY_PREFIX} Alpha`, website: "https://alpha.example" });

    const badSite = await api("/api/admin/companies", { method: "POST", cookie: admin, json: { name: `${COMPANY_PREFIX} Bad`, website: "ftp://x" } });
    assert.equal(badSite.status, 400);
    const extra = await api("/api/admin/companies", { method: "POST", cookie: admin, json: { name: `${COMPANY_PREFIX} Bad`, companyId: 5 } });
    assert.equal(extra.status, 400, "strict schema rejects unknown fields");
  });

  it("rejects a duplicate name with 409 (UNIQUE companies_name_key)", async () => {
    const r = await api("/api/admin/companies", { method: "POST", cookie: admin, json: { name: `${COMPANY_PREFIX} Alpha` } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, "COMPANY_NAME_TAKEN");
  });

  it("lists, reads and edits a company", async () => {
    const list = await api("/api/admin/companies", { cookie: admin });
    const row = list.body.companies.find((c) => c.id === company.id);
    assert.deepEqual([row.recruiterCount, row.jobCount, row.applicationCount], [0, 0, 0]);

    const patch = await api(`/api/admin/companies/${company.id}`, { method: "PATCH", cookie: admin, json: { location: "Mangaluru, Karnataka", website: "" } });
    assert.equal(patch.status, 200, patch.text);
    assert.equal(patch.body.company.location, "Mangaluru, Karnataka");
    assert.equal(patch.body.company.website, null);
    assert.equal(patch.body.company.industry, "Testing", "fields not sent are unchanged");

    const read = await api(`/api/admin/companies/${company.id}`, { cookie: admin });
    assert.equal(read.body.company.location, "Mangaluru, Karnataka");
    assert.equal((await api("/api/admin/companies/999999999", { cookie: admin })).status, 404);
    assert.equal((await api("/api/admin/companies/abc", { cookie: admin })).status, 400);
  });

  it("deletes a company that has no recruiters or jobs", async () => {
    const r = await api(`/api/admin/companies/${company.id}`, { method: "DELETE", cookie: admin });
    assert.equal(r.status, 200, r.text);
    assert.equal((await db.query("SELECT 1 FROM companies WHERE company_id = $1", [company.id])).rowCount, 0);
  });

  it("the DATABASE rejects deleting a company that has jobs (jobs_company_fkey, ON DELETE RESTRICT)", async () => {
    const withJob = await createCompany("WithJob");
    await db.query(
      `INSERT INTO jobs (company_id, title, description, location, status)
       VALUES ($1, 'Admin test job', repeat('A realistic but fictional job description. ', 3), 'Remote', 'draft')`, [withJob.id]);

    // 1. Directly in SQL: PostgreSQL itself refuses with a foreign-key violation.
    await assert.rejects(db.query("DELETE FROM companies WHERE company_id = $1", [withJob.id]),
      (err) => err.code === "23503" && err.constraint === "jobs_company_fkey");

    // 2. Through the API: a readable 409, not a crash, and the row is still there.
    const r = await api(`/api/admin/companies/${withJob.id}`, { method: "DELETE", cookie: admin });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body.error.code, "COMPANY_IN_USE");
    assert.equal(r.body.error.details.constraint, "jobs_company_fkey");
    assert.equal(r.body.error.details.jobs, 1);
    assert.match(r.body.error.message, /cannot be deleted because it still has 1 job/);
    assert.equal((await db.query("SELECT 1 FROM companies WHERE company_id = $1", [withJob.id])).rowCount, 1);
  });

  it("the database also rejects deleting a company that still employs recruiters", async () => {
    const withRecruiter = await createCompany("WithRecruiter");
    await newRecruiter(withRecruiter.id, "emp");
    const r = await api(`/api/admin/companies/${withRecruiter.id}`, { method: "DELETE", cookie: admin });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body.error.details.constraint, "recruiters_company_fkey");
    assert.equal(r.body.error.details.recruiters, 1);
  });

  it("seeded companies with recruiters and jobs cannot be deleted", async () => {
    const r = await api("/api/admin/companies/1", { method: "DELETE", cookie: admin });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /Nimbus Analytics Pvt Ltd cannot be deleted because it still has 2 recruiters and 3 jobs/);
  });
});

// ---------------------------------------------------------- recruiters ----
describe("recruiter account creation", () => {
  let company;
  before(async () => { company = await createCompany("Hiring"); });

  it("creates users + recruiters rows with a bcrypt hash (201)", async () => {
    const rec = await newRecruiter(company.id, "ok");
    assert.equal(rec.companyId, company.id);
    assert.equal(rec.isActive, true);
    assert.ok(!JSON.stringify(rec).includes("$2"), "no hash in the response");

    const [user] = await userRows(rec.email);
    assert.equal(user.role, "recruiter");
    assert.match(user.password_hash, /^\$2[aby]\$12\$/);
    assert.notEqual(user.password_hash, NEW_PASSWORD);
    const profile = await db.query("SELECT company_id::int, designation FROM recruiters WHERE user_id = $1", [user.user_id]);
    assert.deepEqual(profile.rows[0], { company_id: company.id, designation: "Recruiter" });

    // The new recruiter can sign in with the password the admin set.
    await login(rec.email, NEW_PASSWORD);
  });

  it("rejects a duplicate email with 409 and keeps a single row", async () => {
    const email = testEmail("dup");
    const json = { fullName: "Dup Recruiter", email, password: NEW_PASSWORD, companyId: company.id };
    assert.equal((await api("/api/admin/recruiters", { method: "POST", cookie: admin, json })).status, 201);
    const again = await api("/api/admin/recruiters", { method: "POST", cookie: admin, json });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "EMAIL_TAKEN");
    assert.equal((await userRows(email)).length, 1);
  });

  it("is atomic: a failure after the users INSERT leaves no users row (API, unknown company)", async () => {
    const email = testEmail("atomic");
    const seq = "SELECT last_value::bigint AS v FROM users_user_id_seq";
    const before = (await db.query(seq)).rows[0].v;

    // companyId passes validation but has no row: INSERT INTO users succeeds,
    // INSERT INTO recruiters then fails on recruiters_company_fkey -> ROLLBACK.
    const r = await api("/api/admin/recruiters", { method: "POST", cookie: admin,
      json: { fullName: "Ghost Recruiter", email, password: NEW_PASSWORD, companyId: 999999999 } });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error.details.constraint, "recruiters_company_fkey");

    // Evidence the users INSERT really ran: identity values are never rolled
    // back, so the sequence moved on. But the row itself is gone.
    const afterSeq = (await db.query(seq)).rows[0].v;
    assert.ok(BigInt(afterSeq) > BigInt(before), `sequence ${before} -> ${afterSeq}`);
    assert.equal((await userRows(email)).length, 0, "no orphan users row");
  });

  it("is atomic: a forced error right after the users INSERT rolls it back (library hook)", async () => {
    const email = testEmail("forced");
    let seenInside = null;
    await assert.rejects(createRecruiter(
      { fullName: "Forced Failure", email, password: NEW_PASSWORD, companyId: company.id, designation: null, phone: null },
      { afterUserInsert: async (client, userId) => {
        // Inside the transaction the row exists...
        seenInside = (await client.query("SELECT user_id::int FROM users WHERE user_id = $1", [userId])).rows[0];
        throw new Error("forced failure after users insert");
      } }), /forced failure/);
    assert.ok(seenInside?.user_id > 0, "the users row existed inside the transaction");
    // ...and after ROLLBACK it does not, and no recruiter profile either.
    assert.equal((await userRows(email)).length, 0);
    assert.equal((await db.query("SELECT 1 FROM recruiters WHERE user_id = $1", [seenInside.user_id])).rowCount, 0);
  });

  it("never lets the request choose the role", async () => {
    const r = await api("/api/admin/recruiters", { method: "POST", cookie: admin,
      json: { fullName: "Role Trick", email: testEmail("role"), password: NEW_PASSWORD, companyId: company.id, role: "admin" } });
    assert.equal(r.status, 400);
  });
});

describe("recruiter edit, reassignment and deactivation", () => {
  let companyA, companyB, rec, cookie;
  before(async () => {
    companyA = await createCompany("DeactA");
    companyB = await createCompany("DeactB");
    rec = await newRecruiter(companyA.id, "deact");
    cookie = await login(rec.email, NEW_PASSWORD);
  });

  it("edits name and moves a recruiter without jobs to another company", async () => {
    const r = await api(`/api/admin/recruiters/${rec.id}`, { method: "PATCH", cookie: admin,
      json: { fullName: "Renamed Recruiter", companyId: companyB.id, phone: "+91 98450 12345" } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.recruiter.fullName, r.body.recruiter.companyId, r.body.recruiter.phone],
      ["Renamed Recruiter", companyB.id, "+91 98450 12345"]);
  });

  it("the database blocks moving a recruiter who still owns jobs (composite FK jobs_recruiter_fkey)", async () => {
    const r = await api("/api/admin/recruiters/2", { method: "PATCH", cookie: admin, json: { companyId: 2 } });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body.error.code, "RECRUITER_OWNS_JOBS");
    assert.equal(r.body.error.details.constraint, "jobs_recruiter_fkey");
    assert.equal((await db.query("SELECT company_id::int FROM recruiters WHERE user_id = 2")).rows[0].company_id, 1);
  });

  it("a deactivated recruiter's existing session is rejected and they cannot log in", async () => {
    assert.equal((await api("/api/auth/me", { cookie })).status, 200, "session works before");
    assert.equal((await api("/api/recruiter/jobs", { cookie })).status, 200);

    const off = await api(`/api/admin/recruiters/${rec.id}`, { method: "PATCH", cookie: admin, json: { isActive: false } });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.body.recruiter.isActive, false);
    assert.equal((await userRows(rec.email))[0].is_active, false);

    // Same, still unexpired, correctly signed cookie: now refused.
    assert.equal((await api("/api/auth/me", { cookie })).status, 401);
    assert.equal((await api("/api/recruiter/jobs", { cookie })).status, 401);

    const relogin = await api("/api/auth/login", { method: "POST", json: { email: rec.email, password: NEW_PASSWORD } });
    assert.equal(relogin.status, 403);
    assert.equal(relogin.body.error.code, "ACCOUNT_DISABLED");
    assert.equal(relogin.sessionCookie, null, "no cookie issued");
  });

  it("reactivating restores access", async () => {
    const on = await api(`/api/admin/recruiters/${rec.id}`, { method: "PATCH", cookie: admin, json: { isActive: true } });
    assert.equal(on.status, 200);
    assert.equal((await api("/api/auth/me", { cookie })).status, 200);
  });

  it("only recruiter accounts can be managed here", async () => {
    // user 1 is the admin, the first candidate id is not a recruiter either
    assert.equal((await api("/api/admin/recruiters/1", { method: "PATCH", cookie: admin, json: { isActive: false } })).status, 404);
    assert.equal((await db.query("SELECT is_active FROM users WHERE user_id = 1")).rows[0].is_active, true);
  });
});

// ----------------------------------------------------------- dashboard ----
// Every number is re-computed here from the BASE TABLES with independent SQL
// (no views, no stored function), then compared with the API response.
describe("admin dashboard numbers match independent SQL", () => {
  let d;
  before(async () => {
    const r = await api("/api/admin/dashboard", { cookie: admin });
    assert.equal(r.status, 200, r.text);
    d = r.body;
  });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];

  it("totals", async () => {
    const t = await one(`SELECT
      (SELECT count(*) FROM users WHERE role = 'candidate')::int AS candidates,
      (SELECT count(*) FROM users WHERE role = 'recruiter')::int AS recruiters,
      (SELECT count(*) FROM users WHERE role = 'recruiter' AND is_active)::int AS "activeRecruiters",
      (SELECT count(*) FROM companies)::int AS companies,
      (SELECT count(*) FILTER (WHERE status = 'open') FROM jobs)::int AS "openJobs",
      (SELECT count(*) FROM applications)::int AS applications,
      (SELECT count(*) FROM interviews)::int AS interviews,
      (SELECT count(*) FROM offers)::int AS offers`);
    assert.deepEqual(d.totals, t);
    console.log("  totals", JSON.stringify(t));
  });

  it("applications per stage", async () => {
    const { rows } = await db.query("SELECT status, count(*)::int AS n FROM applications GROUP BY status");
    const expected = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    assert.deepEqual(d.applicationsByStage.map((s) => s.status), ["applied", "shortlisted", "interviewed", "offered", "rejected"]);
    for (const s of d.applicationsByStage) assert.equal(s.count, expected[s.status] ?? 0, s.status);
    assert.equal(d.applicationsByStage.reduce((a, s) => a + s.count, 0), d.totals.applications);
  });

  it("top demanded skills (>= 2 open jobs)", async () => {
    const { rows } = await db.query(
      `SELECT js.skill_id::int AS id, js.is_required FROM job_skills js JOIN jobs j USING (job_id) WHERE j.status = 'open'`);
    const counts = new Map();
    for (const r of rows) {
      const c = counts.get(r.id) || { jobCount: 0, requiredCount: 0 };
      c.jobCount += 1; c.requiredCount += r.is_required ? 1 : 0; counts.set(r.id, c);
    }
    const expected = [...counts].filter(([, c]) => c.jobCount >= 2);
    assert.equal(d.topSkills.length, Math.min(10, expected.length));
    for (const s of d.topSkills) assert.deepEqual({ jobCount: s.jobCount, requiredCount: s.requiredCount }, counts.get(s.id), s.name);
    for (let i = 1; i < d.topSkills.length; i++) assert.ok(d.topSkills[i - 1].jobCount >= d.topSkills[i].jobCount, "sorted by demand");
  });

  it("average match score by status", async () => {
    const { rows } = await db.query(
      `SELECT status, count(*)::int AS n, count(match_score)::int AS scored, round(avg(match_score), 4)::float8 AS avg
         FROM applications GROUP BY status`);
    const expected = Object.fromEntries(rows.map((r) => [r.status, r]));
    assert.equal(d.matchScoreByStatus.length, rows.length);
    for (const m of d.matchScoreByStatus) {
      const e = expected[m.status];
      assert.deepEqual([m.applications, m.scored, m.avgMatchScore], [e.n, e.scored, e.avg], m.status);
    }
    console.log("  avg match score", d.matchScoreByStatus.map((m) => `${m.status}=${m.avgMatchScore}`).join(" "));
  });

  it("per company: jobs, applications, offer acceptance, interview rating, above-average flag", async () => {
    const { rows } = await db.query("SELECT company_id::int AS id FROM companies");
    assert.equal(d.companies.length, rows.length);
    let total = 0;
    for (const c of d.companies) {
      const e = await one(`SELECT
        (SELECT count(*) FROM jobs WHERE company_id = $1)::int AS jobs,
        (SELECT count(*) FROM jobs WHERE company_id = $1 AND status = 'open')::int AS "openJobs",
        (SELECT count(*) FROM applications a JOIN jobs j ON j.job_id = a.job_id WHERE j.company_id = $1)::int AS applications,
        (SELECT count(*) FROM offers o JOIN applications a USING (application_id) JOIN jobs j ON j.job_id = a.job_id WHERE j.company_id = $1)::int AS "offersMade",
        (SELECT count(*) FROM offers o JOIN applications a USING (application_id) JOIN jobs j ON j.job_id = a.job_id WHERE j.company_id = $1 AND o.status = 'accepted')::int AS "offersAccepted",
        (SELECT count(*) FROM offers o JOIN applications a USING (application_id) JOIN jobs j ON j.job_id = a.job_id WHERE j.company_id = $1 AND o.status = 'declined')::int AS "offersDeclined",
        (SELECT round(avg(i.rating), 2)::float8 FROM interviews i JOIN applications a USING (application_id) JOIN jobs j ON j.job_id = a.job_id WHERE j.company_id = $1) AS "avgInterviewRating",
        (SELECT count(i.rating)::int FROM interviews i JOIN applications a USING (application_id) JOIN jobs j ON j.job_id = a.job_id WHERE j.company_id = $1) AS "ratedInterviews"`, [c.id]);
      const decided = e.offersAccepted + e.offersDeclined;
      e.acceptanceRatePct = decided ? Math.round((1000 * e.offersAccepted) / decided) / 10 : null;
      for (const key of Object.keys(e)) assert.deepEqual(c[key], e[key], `${c.name} ${key}`);
      total += e.applications;
    }
    const avg = total / rows.length;
    assert.equal(d.avgApplicationsPerCompany, Math.round(avg * 100) / 100);
    for (const c of d.companies) assert.equal(c.aboveAverage, c.applications > avg, `${c.name} aboveAverage`);
    assert.ok(d.companies.some((c) => c.aboveAverage), "seed data has at least one above-average company");
  });

  it("applications per job (generate_hiring_pipeline_report) match a GROUP BY on applications", async () => {
    const { rows } = await db.query(
      `SELECT j.job_id::int AS id, count(a.application_id)::int AS applications,
              count(*) FILTER (WHERE a.status = 'applied')::int AS applied,
              count(*) FILTER (WHERE a.status = 'shortlisted')::int AS shortlisted,
              count(*) FILTER (WHERE a.status = 'interviewed')::int AS interviewed,
              count(*) FILTER (WHERE a.status = 'offered')::int AS offered,
              count(*) FILTER (WHERE a.status = 'rejected')::int AS rejected
         FROM jobs j LEFT JOIN applications a ON a.job_id = j.job_id GROUP BY j.job_id`);
    assert.equal(d.jobs.length, rows.length);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const j of d.jobs) {
      const { id, ...e } = byId[j.id];
      assert.deepEqual({ applications: j.applications, applied: j.applied, shortlisted: j.shortlisted, interviewed: j.interviewed, offered: j.offered, rejected: j.rejected }, e, j.title);
    }
  });
});
