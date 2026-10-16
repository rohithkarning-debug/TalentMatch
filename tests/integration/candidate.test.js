// Candidate-module integration tests against the production Next.js server and PostgreSQL.
import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
process.env.TEST_PORT = "3101";
const { makeClient, startServer } = await import("./helpers.js");

const RUN = Date.now().toString(36);
const DEMO_PASSWORD = "TalentMatch@2026";
let server, api, db, candidateCookie, candidateId, candidateEmail;
let uploadedResumeId;
// tests/fixtures/sample-resume.pdf: a real PDF printed by a browser from
// sample-resume.html (embedded fonts, compressed streams), fictional content.
const SAMPLE_PDF = await readFile(new URL("../fixtures/sample-resume.pdf", import.meta.url));
const RESUME_TEXT = "This is a test resume with enough extractable content to satisfy the minimum fifty character rule.";

async function login(email, password = DEMO_PASSWORD) {
  const result = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(result.status, 200, result.text);
  return { user: result.body.user, cookie: result.sessionCookie.value };
}

function resumeForm(content, fileName, type) {
  const form = new FormData();
  form.append("file", new Blob([content], { type }), fileName);
  return form;
}

async function registerCandidate(tag) {
  const result = await api("/api/auth/register", { method: "POST", json: { fullName: `Candidate Module ${tag}`, email: `candidate.module.${RUN}.${tag}@test.example`, password: "Testpass123" } });
  assert.equal(result.status, 201, result.text);
  return { id: result.body.user.id, cookie: result.sessionCookie.value };
}

async function resumeRowCount(userId) {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM resumes WHERE candidate_id = $1", [userId]);
  return rows[0].n;
}

before(async () => {
  assert.ok(process.env.AUTH_JWT_SECRET && process.env.DATABASE_URL, "Set .env.local before integration tests");
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  server = await startServer();
  api = makeClient(server.baseUrl);
  candidateEmail = `candidate.module.${RUN}@test.example`;
  const registered = await api("/api/auth/register", { method: "POST", json: { fullName: "Candidate Module Test", email: candidateEmail, password: "Testpass123" } });
  assert.equal(registered.status, 201, registered.text);
  candidateCookie = registered.sessionCookie.value;
  candidateId = registered.body.user.id;
});

after(async () => {
  if (uploadedResumeId && candidateCookie) {
    await api(`/api/candidate/resumes/${uploadedResumeId}`, { method: "DELETE", cookie: candidateCookie }).catch(() => {});
  }
  // Remove uploaded files of every test account, then the accounts (rows cascade).
  const pattern = `candidate.module.${RUN}%@test.example`;
  const files = await db?.query(
    "SELECT r.storage_path FROM resumes r JOIN users u ON u.user_id = r.candidate_id WHERE u.email LIKE $1 AND r.storage_path IS NOT NULL", [pattern]);
  for (const { storage_path: p } of files?.rows || []) await unlink(path.resolve(p)).catch(() => {});
  await db?.query("DELETE FROM users WHERE email LIKE $1", [pattern]);
  await db?.end();
  await server?.stop();
});

describe("candidate profile, skills, and resumes", () => {
  it("requires authentication and candidate role on candidate endpoints", async () => {
    assert.equal((await api("/api/candidate/profile")).status, 401);
    const recruiter = await login("meera.iyer@nimbusanalytics.example");
    assert.equal((await api("/api/candidate/profile", { cookie: recruiter.cookie })).status, 403);
    assert.equal((await api("/api/candidate/skills", { cookie: recruiter.cookie })).status, 403);
    assert.equal((await api("/api/candidate/resumes", { cookie: recruiter.cookie })).status, 403);
  });

  it("reads and updates only the authenticated candidate profile", async () => {
    const read = await api("/api/candidate/profile", { cookie: candidateCookie });
    assert.equal(read.status, 200, read.text);
    assert.equal(Number(read.body.profile.id), Number(candidateId));
    const updated = await api("/api/candidate/profile", { method: "PATCH", cookie: candidateCookie, json: { fullName: "Candidate Module Updated", location: "Bengaluru", yearsExperience: 1.5 } });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.body.profile.fullName, "Candidate Module Updated");
    assert.equal(updated.body.profile.location, "Bengaluru");
    assert.equal((await api("/api/candidate/profile", { method: "PATCH", cookie: candidateCookie, json: { role: "admin" } })).status, 400);
  });

  it("saves a profile whose optional fields are cleared (null or empty)", async () => {
    const result = await api("/api/candidate/profile", { method: "PATCH", cookie: candidateCookie, json: { fullName: "Candidate Module Updated", phone: null, location: null, headline: "", highestEducation: null, yearsExperience: 0 } });
    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.profile.location, null);
    assert.equal(result.body.profile.headline, null);
  });

  it("adds and removes a catalogue skill with validated proficiency", async () => {
    const catalog = await api("/api/candidate/skills", { cookie: candidateCookie });
    assert.equal(catalog.status, 200, catalog.text);
    assert.ok(catalog.body.catalog.length > 0);
    const skill = catalog.body.catalog[0];
    const added = await api("/api/candidate/skills", { method: "POST", cookie: candidateCookie, json: { skillId: skill.id, proficiency: 4, yearsUsed: 1.5 } });
    assert.equal(added.status, 201, added.text);
    const mine = await api("/api/candidate/skills", { cookie: candidateCookie });
    assert.ok(mine.body.skills.some((item) => item.id === skill.id && item.proficiency === 4));
    assert.equal((await api(`/api/candidate/skills/${skill.id}`, { method: "DELETE", cookie: candidateCookie })).status, 200);
    assert.equal((await api("/api/candidate/skills", { cookie: candidateCookie })).body.skills.some((item) => item.id === skill.id), false);
    assert.equal((await api("/api/candidate/skills", { method: "POST", cookie: candidateCookie, json: { skillId: skill.id, proficiency: 8, yearsUsed: 0 } })).status, 400);
  });

  it("returns 201 when a skill is created and 200 when it is updated", async () => {
    const skill = (await api("/api/candidate/skills", { cookie: candidateCookie })).body.catalog[1];
    const created = await api("/api/candidate/skills", { method: "POST", cookie: candidateCookie, json: { skillId: skill.id, proficiency: 2, yearsUsed: 0.5 } });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.created, true);
    const updated = await api("/api/candidate/skills", { method: "POST", cookie: candidateCookie, json: { skillId: skill.id, proficiency: 5, yearsUsed: 3 } });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.body.created, false);
    const mine = (await api("/api/candidate/skills", { cookie: candidateCookie })).body.skills.find((item) => item.id === skill.id);
    assert.equal(mine.proficiency, 5);
    assert.equal(mine.yearsUsed, 3);
  });

  it("cannot delete another candidate's skill (404, row kept)", async () => {
    const { rows } = await db.query(
      `SELECT cs.skill_id::int AS "skillId", cs.candidate_id AS owner FROM candidate_skills cs
         JOIN users u ON u.user_id = cs.candidate_id WHERE u.email = 'aditi.sharma@mail.example' LIMIT 1`);
    assert.ok(rows[0], "seeded candidate should have a skill");
    const result = await api(`/api/candidate/skills/${rows[0].skillId}`, { method: "DELETE", cookie: candidateCookie });
    assert.equal(result.status, 404, result.text);
    const kept = await db.query("SELECT 1 FROM candidate_skills WHERE candidate_id = $1 AND skill_id = $2", [rows[0].owner, rows[0].skillId]);
    assert.equal(kept.rowCount, 1);
  });

  it("uploads and lists a text resume, then deletes it for its owner", async () => {
    const uploaded = await api("/api/candidate/resumes", { method: "POST", cookie: candidateCookie, body: resumeForm(RESUME_TEXT, "candidate-test.txt", "text/plain") });
    assert.equal(uploaded.status, 201, uploaded.text);
    uploadedResumeId = uploaded.body.resume.id;
    const list = await api("/api/candidate/resumes", { cookie: candidateCookie });
    assert.ok(list.body.resumes.some((resume) => resume.id === uploadedResumeId));
    const other = await login("aditi.sharma@mail.example");
    assert.equal((await api(`/api/candidate/resumes/${uploadedResumeId}`, { method: "DELETE", cookie: other.cookie })).status, 404);
    assert.equal((await db.query("SELECT 1 FROM resumes WHERE resume_id = $1", [uploadedResumeId])).rowCount, 1, "row kept after the other candidate's delete");
    assert.equal((await api(`/api/candidate/resumes/${uploadedResumeId}`, { method: "DELETE", cookie: candidateCookie })).status, 200);
    uploadedResumeId = null;
  });

  it("extracts text from a real PDF under the production build", async () => {
    const candidate = await registerCandidate("pdf");
    const uploaded = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(SAMPLE_PDF, "sample-resume.pdf", "application/pdf") });
    assert.equal(uploaded.status, 201, uploaded.text);
    assert.equal(uploaded.body.resume.mimeType, "application/pdf");
    assert.equal(uploaded.body.resume.fileSizeBytes, SAMPLE_PDF.length);
    assert.equal(uploaded.body.resume.isPrimary, true, "first resume becomes primary");
    const { rows } = await db.query("SELECT extracted_text FROM resumes WHERE resume_id = $1", [uploaded.body.resume.id]);
    assert.match(rows[0].extracted_text, /Priya Natarajan/);
    assert.match(rows[0].extracted_text, /PostgreSQL/);
  });

  it("rejects oversized, wrong-type, and malformed resume files without saving them", async () => {
    const candidate = await registerCandidate("reject");
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, "a");
    const big = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(oversized, "big.txt", "text/plain") });
    assert.equal(big.status, 413, big.text);
    assert.equal(big.body.error.code, "FILE_SIZE");
    const docx = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(RESUME_TEXT, "resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") });
    assert.equal(docx.status, 415, docx.text);
    assert.equal(docx.body.error.code, "FILE_TYPE");
    const png = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(RESUME_TEXT, "resume.pdf", "image/png") });
    assert.equal(png.status, 415, png.text);
    const fakePdf = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(RESUME_TEXT, "resume.pdf", "application/pdf") });
    assert.equal(fakePdf.status, 400, fakePdf.text);
    assert.equal(fakePdf.body.error.code, "INVALID_PDF");
    const brokenPdf = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(`%PDF-1.7\n${"garbage ".repeat(20)}`, "broken.pdf", "application/pdf") });
    assert.equal(brokenPdf.status, 400, brokenPdf.text);
    assert.equal(brokenPdf.body.error.code, "INVALID_PDF");
    assert.equal(await resumeRowCount(candidate.id), 0);
  });

  it("sets the primary resume in one transaction, only for the owner", async () => {
    const candidate = await registerCandidate("primary");
    const first = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(RESUME_TEXT, "first.txt", "text/plain") });
    const second = await api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(SAMPLE_PDF, "second.pdf", "application/pdf") });
    assert.equal(first.status, 201, first.text);
    assert.equal(second.status, 201, second.text);
    assert.equal(first.body.resume.isPrimary, true);
    assert.equal(second.body.resume.isPrimary, false);

    const changed = await api(`/api/candidate/resumes/${second.body.resume.id}`, { method: "PATCH", cookie: candidate.cookie, json: { isPrimary: true } });
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.body.resume.isPrimary, true);
    const { rows } = await db.query("SELECT resume_id::text AS id FROM resumes WHERE candidate_id = $1 AND is_primary", [candidate.id]);
    assert.deepEqual(rows.map((r) => r.id), [String(second.body.resume.id)], "exactly one primary");

    // Setting the current primary again is a no-op success.
    assert.equal((await api(`/api/candidate/resumes/${second.body.resume.id}`, { method: "PATCH", cookie: candidate.cookie, json: { isPrimary: true } })).status, 200);
    // Another candidate cannot touch it; bad bodies and ids are rejected.
    assert.equal((await api(`/api/candidate/resumes/${first.body.resume.id}`, { method: "PATCH", cookie: candidateCookie, json: { isPrimary: true } })).status, 404);
    assert.equal((await api(`/api/candidate/resumes/${first.body.resume.id}`, { method: "PATCH", cookie: candidate.cookie, json: { isPrimary: false } })).status, 400);
    assert.equal((await api(`/api/candidate/resumes/${first.body.resume.id}`, { method: "PATCH", cookie: candidate.cookie, json: { isPrimary: true, candidateId: 1 } })).status, 400);
    assert.equal((await api("/api/candidate/resumes/abc", { method: "PATCH", cookie: candidate.cookie, json: { isPrimary: true } })).status, 404);
    const stillPrimary = await db.query("SELECT is_primary FROM resumes WHERE resume_id = $1", [second.body.resume.id]);
    assert.equal(stillPrimary.rows[0].is_primary, true);

    // Deleting the primary promotes the remaining resume.
    assert.equal((await api(`/api/candidate/resumes/${second.body.resume.id}`, { method: "DELETE", cookie: candidate.cookie })).status, 200);
    const promoted = await db.query("SELECT is_primary FROM resumes WHERE resume_id = $1", [first.body.resume.id]);
    assert.equal(promoted.rows[0].is_primary, true);
  });

  it("parallel first uploads all succeed with exactly one primary resume", async () => {
    // The race window is small, so try several fresh candidates. Without the
    // candidate row lock some uploads fail with 409 (one-primary unique index).
    const UPLOADS = 8;
    for (let round = 1; round <= 5; round++) {
      const candidate = await registerCandidate(`race${round}`);
      const uploads = await Promise.all(Array.from({ length: UPLOADS }, (_, n) =>
        api("/api/candidate/resumes", { method: "POST", cookie: candidate.cookie, body: resumeForm(`${RESUME_TEXT} Copy ${n}.`, `race-${n}.txt`, "text/plain") })));
      assert.deepEqual(uploads.map((u) => u.status), Array(UPLOADS).fill(201), `round ${round}: ${uploads.map((u) => u.text).join("\n")}`);
      const { rows } = await db.query("SELECT count(*) FILTER (WHERE is_primary)::int AS primaries, count(*)::int AS total FROM resumes WHERE candidate_id = $1", [candidate.id]);
      assert.deepEqual(rows[0], { primaries: 1, total: UPLOADS });
    }
  });
});

describe("candidate job browsing", () => {
  const ids = (result) => result.body.jobs.map((job) => job.id).sort((a, b) => a - b);
  const expected = (predicate) => openJobs.filter(predicate).map((j) => j.id).sort((a, b) => a - b);
  let openJobs;

  before(async () => {
    const { rows } = await db.query("SELECT job_id::int AS id, location, employment_type, min_experience_years::float8 AS exp FROM jobs WHERE status = 'open'");
    openJobs = rows;
  });

  it("is restricted to candidates", async () => {
    assert.equal((await api("/api/candidate/jobs")).status, 401);
    const recruiter = await login("meera.iyer@nimbusanalytics.example");
    assert.equal((await api("/api/candidate/jobs", { cookie: recruiter.cookie })).status, 403);
    const admin = await login("admin@talentmatch.example");
    assert.equal((await api("/api/candidate/jobs", { cookie: admin.cookie })).status, 403);
  });

  it("lists every open job and no draft or closed job", async () => {
    const result = await api("/api/candidate/jobs", { cookie: candidateCookie });
    assert.equal(result.status, 200, result.text);
    assert.deepEqual(ids(result), expected(() => true));
    const hidden = await db.query("SELECT job_id::int AS id FROM jobs WHERE status <> 'open'");
    assert.ok(hidden.rowCount > 0, "seed should include non-open jobs");
    for (const { id } of hidden.rows) assert.ok(!ids(result).includes(id), `job ${id} is not open`);
    assert.ok(result.body.locations.length > 0);
  });

  it("filters by keyword in title, description, company or skill", async () => {
    const byKeyword = await api("/api/candidate/jobs?q=devops", { cookie: candidateCookie });
    assert.ok(byKeyword.body.jobs.length >= 1);
    for (const job of byKeyword.body.jobs) {
      const haystack = [job.title, job.description, job.company, ...job.skills].join(" ").toLowerCase();
      assert.ok(haystack.includes("devops"), job.title);
    }
    const bySkill = await api("/api/candidate/jobs?q=python", { cookie: candidateCookie });
    assert.ok(bySkill.body.jobs.some((job) => job.skills.some((s) => s.toLowerCase() === "python")));
    assert.equal((await api("/api/candidate/jobs?q=zzzz-no-such-job", { cookie: candidateCookie })).body.jobs.length, 0);
    // LIKE wildcards and SQL-looking text are treated as plain text.
    assert.equal((await api("/api/candidate/jobs?q=%25", { cookie: candidateCookie })).body.jobs.length, 0);
    const injection = await api(`/api/candidate/jobs?q=${encodeURIComponent("' OR 1=1 --")}`, { cookie: candidateCookie });
    assert.equal(injection.status, 200);
    assert.equal(injection.body.jobs.length, 0);
  });

  it("filters by location, employment type and experience, alone and combined", async () => {
    const pune = await api("/api/candidate/jobs?location=pune", { cookie: candidateCookie });
    assert.deepEqual(ids(pune), expected((j) => j.location === "Pune"));
    const internships = await api("/api/candidate/jobs?employmentType=internship", { cookie: candidateCookie });
    assert.deepEqual(ids(internships), expected((j) => j.employment_type === "internship"));
    const junior = await api("/api/candidate/jobs?experience=1.5", { cookie: candidateCookie });
    assert.deepEqual(ids(junior), expected((j) => j.exp <= 1.5));
    const combined = await api("/api/candidate/jobs?location=Bengaluru&employmentType=full_time&experience=1", { cookie: candidateCookie });
    assert.deepEqual(ids(combined), expected((j) => j.location === "Bengaluru" && j.employment_type === "full_time" && j.exp <= 1));
    assert.ok(combined.body.jobs.length > 0, "combined filter should match a seeded job");
    const empty = await api("/api/candidate/jobs?q=&location=&employmentType=&experience=", { cookie: candidateCookie });
    assert.equal(empty.body.jobs.length, openJobs.length, "empty filters mean no filter");
  });

  it("rejects invalid filter values and unknown parameters", async () => {
    for (const qs of ["employmentType=permanent", "experience=-1", "experience=abc", "status=draft", `q=${"x".repeat(101)}`]) {
      const result = await api(`/api/candidate/jobs?${qs}`, { cookie: candidateCookie });
      assert.equal(result.status, 400, `${qs}: ${result.text}`);
    }
  });

  it("marks jobs the candidate has already applied to", async () => {
    const aditi = await login("aditi.sharma@mail.example");
    const result = await api("/api/candidate/jobs", { cookie: aditi.cookie });
    const { rows } = await db.query("SELECT a.job_id::int AS id FROM applications a JOIN jobs j ON j.job_id = a.job_id WHERE a.candidate_id = $1 AND j.status = 'open'", [aditi.user.id]);
    assert.ok(rows.length > 0, "seeded candidate should have applications");
    assert.deepEqual(result.body.jobs.filter((j) => j.hasApplied).map((j) => j.id).sort((a, b) => a - b), rows.map((r) => r.id).sort((a, b) => a - b));
  });
});
