// Stage 6: recruiter module and applications, tested against the production
// Next.js server, the real database and the real embedding model.
// No score is hard-coded: every match score is re-computed in SQL.
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
process.env.TEST_PORT = "3103";
const { makeClient, startServer } = await import("./helpers.js");
const { applyToJob } = await import("../../src/lib/applications.js");
const { getSkillGap } = await import("../../src/lib/candidate/skill-gap.js");
const { getPool } = await import("../../src/lib/db.js");

const RUN = Date.now().toString(36);
const DEMO_PASSWORD = "TalentMatch@2026";
const MEERA = "meera.iyer@nimbusanalytics.example"; // Nimbus Analytics
const KAVYA = "kavya.menon@kestrellabs.example";    // Kestrel Software Labs
const EMAIL_PATTERN = `recruiter.flow.${RUN}.%@test.example`;

let server, api, db;
let meera, kavya, meeraId;
const createdJobIds = [];
const skillIds = {};

async function login(email, password = DEMO_PASSWORD) {
  const result = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(result.status, 200, result.text);
  return result.sessionCookie.value;
}

// A fresh candidate with an uploaded (and therefore embedded) .txt resume.
async function newCandidate(tag, resumeText, skills = []) {
  const reg = await api("/api/auth/register", { method: "POST", json: {
    fullName: `Flow Candidate ${tag}`, email: `recruiter.flow.${RUN}.${tag}@test.example`, password: "Testpass123" } });
  assert.equal(reg.status, 201, reg.text);
  const cookie = reg.sessionCookie.value;
  const form = new FormData();
  form.append("file", new Blob([resumeText], { type: "text/plain" }), `${tag}.txt`);
  const up = await api("/api/candidate/resumes", { method: "POST", body: form, cookie });
  assert.equal(up.status, 201, up.text);
  for (const [name, proficiency] of skills) {
    const res = await api("/api/candidate/skills", { method: "POST", cookie, json: { skillId: skillIds[name], proficiency, yearsUsed: 1 } });
    assert.ok([200, 201].includes(res.status), res.text);
  }
  return { id: reg.body.user.id, cookie, resumeId: Number(up.body.resume.id), isEmbedded: up.body.resume.isEmbedded };
}

async function createJob(cookie, overrides = {}) {
  const res = await api("/api/recruiter/jobs", { method: "POST", cookie, json: {
    title: `Applied NLP Engineer ${RUN}`,
    description: "Build NLP features in Python: text classification, semantic search with sentence embeddings, and careful model evaluation.",
    location: "Bengaluru", workMode: "hybrid", status: "open",
    skills: [
      { skillId: skillIds.Python, isRequired: true, minProficiency: 3 },
      { skillId: skillIds["Natural Language Processing"], isRequired: true, minProficiency: 2 },
      { skillId: skillIds.Docker, isRequired: false, minProficiency: 2 },
    ],
    ...overrides,
  } });
  if (res.status === 201) createdJobIds.push(res.body.job.id);
  return res;
}

const applicantCount = async (jobId) =>
  (await db.query("SELECT applicant_count FROM jobs WHERE job_id = $1", [jobId])).rows[0].applicant_count;

before(async () => {
  assert.ok(process.env.AUTH_JWT_SECRET && process.env.DATABASE_URL, "Set .env.local before integration tests");
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { rows } = await db.query("SELECT skill_id::int, name FROM skills");
  for (const r of rows) skillIds[r.name] = r.skill_id;
  meeraId = (await db.query("SELECT user_id::int FROM users WHERE email = $1", [MEERA])).rows[0].user_id;
  server = await startServer();
  api = makeClient(server.baseUrl);
  meera = await login(MEERA);
  kavya = await login(KAVYA);
});

after(async () => {
  // Order matters: applications block job deletion (ON DELETE RESTRICT), so
  // remove the test candidates first (their applications cascade, and the
  // trigger lowers applicant_count), then the recruiter notifications about
  // them, then the test jobs.
  const files = await db?.query(
    "SELECT r.storage_path FROM resumes r JOIN users u ON u.user_id = r.candidate_id WHERE u.email LIKE $1 AND r.storage_path IS NOT NULL", [EMAIL_PATTERN]);
  for (const { storage_path: p } of files?.rows || []) await unlink(path.resolve(p)).catch(() => {});
  await db?.query("DELETE FROM users WHERE email LIKE $1", [EMAIL_PATTERN]);
  await db?.query("DELETE FROM notifications WHERE title LIKE $1", [`%${RUN}%`]);
  if (createdJobIds.length) await db?.query("DELETE FROM jobs WHERE job_id = ANY($1::bigint[])", [createdJobIds]);
  await db?.end();
  await getPool().end();
  await server?.stop();
});

describe("full flow: post job -> embed -> apply -> score -> count -> shortlist -> history", () => {
  let job, candidate, application;

  it("recruiter posts a job; it is saved for their company and embedded", async () => {
    const res = await createJob(meera);
    assert.equal(res.status, 201, res.text);
    job = res.body.job;
    assert.equal(job.status, "open");
    assert.equal(job.recruiterId, meeraId);
    assert.equal(job.company, "Nimbus Analytics Pvt Ltd");
    assert.equal(job.applicantCount, 0);
    assert.equal(job.isEmbedded, true);
    assert.deepEqual(job.skills.map((s) => [s.name, s.isRequired]),
      [["Natural Language Processing", true], ["Python", true], ["Docker", false]]);
    const stored = await db.query("SELECT model_name, vector_dims(embedding) AS dims FROM job_embeddings WHERE job_id = $1", [job.id]);
    assert.deepEqual(stored.rows[0], { model_name: "sentence-transformers/all-MiniLM-L6-v2", dims: 384 });
  });

  it("candidate applies; match_score = 1 - (resume <=> job) computed in SQL; applicant_count +1 by trigger", async () => {
    candidate = await newCandidate("main",
      "NLP engineer: I build text classifiers and semantic search with sentence embeddings in Python and evaluate models carefully.",
      [["Python", 4]]);
    assert.equal(candidate.isEmbedded, true);
    const before = await applicantCount(job.id);

    const res = await api("/api/candidate/applications", { method: "POST", cookie: candidate.cookie,
      json: { jobId: job.id, resumeId: candidate.resumeId, coverLetter: "Keen to work on semantic search." } });
    assert.equal(res.status, 201, res.text);
    application = res.body.application;
    assert.equal(application.status, "applied");
    assert.equal(typeof application.matchScore, "number");

    const { rows } = await db.query(
      `SELECT a.match_score::float8 AS stored, (1 - (re.embedding <=> je.embedding))::float8 AS direct
         FROM applications a
         JOIN resume_embeddings re ON re.resume_id = a.resume_id
         JOIN job_embeddings je    ON je.job_id = a.job_id
        WHERE a.application_id = $1`, [application.id]);
    console.log(`  match_score stored ${rows[0].stored}, recomputed 1 - (a <=> b) = ${rows[0].direct}`);
    assert.equal(rows[0].stored, application.matchScore);
    assert.ok(Math.abs(rows[0].stored - rows[0].direct) <= 0.00005, "score must equal the SQL cosine (4-decimal rounding)");
    assert.equal(await applicantCount(job.id), before + 1);
  });

  it("the apply transaction wrote the initial history row and notified the recruiter", async () => {
    const history = await db.query("SELECT old_status, new_status, changed_by::int FROM application_status_history WHERE application_id = $1", [application.id]);
    assert.deepEqual(history.rows, [{ old_status: null, new_status: "applied", changed_by: candidate.id }]);
    const note = await db.query(
      "SELECT user_id::int, type FROM notifications WHERE related_application_id = $1", [application.id]);
    assert.deepEqual(note.rows, [{ user_id: meeraId, type: "application_submitted" }]);
  });

  it("recruiter shortlists via update_application_status(); the trigger writes the history row", async () => {
    const res = await api(`/api/recruiter/applications/${application.id}`, { method: "PATCH", cookie: meera,
      json: { status: "shortlisted", note: "Strong NLP fit" } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.application.status, "shortlisted");
    const history = await db.query(
      "SELECT old_status, new_status, changed_by::int, note FROM application_status_history WHERE application_id = $1 ORDER BY history_id", [application.id]);
    assert.equal(history.rows.length, 2);
    assert.deepEqual(history.rows[1], { old_status: "applied", new_status: "shortlisted", changed_by: meeraId, note: "Strong NLP fit" });
    const notified = await db.query(
      "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'status_changed' AND related_application_id = $2", [candidate.id, application.id]);
    assert.equal(notified.rows[0].n, 1);
  });

  it("recruiter and candidate views show the result", async () => {
    const list = await api(`/api/recruiter/jobs/${job.id}/applications`, { cookie: meera });
    assert.equal(list.status, 200, list.text);
    const row = list.body.applications.find((a) => a.id === application.id);
    assert.equal(row.status, "shortlisted");
    assert.equal(row.matchScore, application.matchScore);
    assert.deepEqual(row.requiredSkills, ["Natural Language Processing", "Python"]);
    assert.deepEqual(row.matchedSkills, ["Python"]);
    assert.equal(row.history.length, 2);

    const jobs = await api("/api/recruiter/jobs", { cookie: meera });
    const listed = jobs.body.jobs.find((j) => j.id === job.id);
    assert.equal(listed.applicantCount, 1);
    assert.equal(listed.shortlisted, 1);

    const matches = await api(`/api/recruiter/jobs/${job.id}/matches?limit=50`, { cookie: meera });
    assert.equal(matches.status, 200, matches.text);
    const match = matches.body.matches.find((m) => m.candidateId === candidate.id);
    assert.equal(match.hasApplied, true);
    assert.equal(match.applicationStatus, "shortlisted");
    assert.deepEqual(match.matchedSkillNames, ["Python"]);
    assert.deepEqual(matches.body.job.requiredSkills, ["Natural Language Processing", "Python"]);

    const mine = await api("/api/candidate/applications", { cookie: candidate.cookie });
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.body.applications.length, 1);
    assert.equal(mine.body.applications[0].status, "shortlisted");
    assert.equal(mine.body.applications[0].matchScore, application.matchScore);
    assert.deepEqual(mine.body.applications[0].history.map((h) => h.newStatus), ["applied", "shortlisted"]);
  });
});

describe("apply transaction rollback", () => {
  it("a failure after the application INSERT leaves no application, no history, no count change", async () => {
    const job = (await createJob(meera, { title: `Rollback test job ${RUN}` })).body.job;
    const candidate = await newCandidate("rollback", "Python developer with natural language processing experience building text classifiers.");
    const countBefore = await applicantCount(job.id);

    // The notification is the LAST step, after the application INSERT and
    // its triggers. A blank title breaks notifications_title_not_blank_check.
    await assert.rejects(
      applyToJob({ candidateId: candidate.id, jobId: job.id, resumeId: candidate.resumeId },
        { notification: () => ({ title: "   ", message: "forced failure" }) }),
      (err) => err.code === "23514" && err.constraint === "notifications_title_not_blank_check");

    const apps = await db.query("SELECT count(*)::int AS n FROM applications WHERE job_id = $1 AND candidate_id = $2", [job.id, candidate.id]);
    assert.equal(apps.rows[0].n, 0, "application row must be rolled back");
    const history = await db.query(
      "SELECT count(*)::int AS n FROM application_status_history h WHERE h.changed_by = $1", [candidate.id]);
    assert.equal(history.rows[0].n, 0, "trigger-written history row must be rolled back");
    assert.equal(await applicantCount(job.id), countBefore, "trigger-updated applicant_count must be rolled back");

    // Nothing was left behind: the same application now succeeds normally.
    const ok = await applyToJob({ candidateId: candidate.id, jobId: job.id, resumeId: candidate.resumeId });
    assert.equal(ok.status, "applied");
    assert.equal(await applicantCount(job.id), countBefore + 1);
  });
});

describe("invalid status transitions are rejected by the database", () => {
  let job, app;
  before(async () => {
    job = (await createJob(meera, { title: `Transition test job ${RUN}` })).body.job;
    const candidate = await newCandidate("transition", "Python and NLP engineer who builds semantic search systems and text classifiers.");
    app = await applyToJob({ candidateId: candidate.id, jobId: job.id, resumeId: candidate.resumeId });
  });

  it("applied -> offered (skipping stages) gets 409 with the trigger's message", async () => {
    const res = await api(`/api/recruiter/applications/${app.id}`, { method: "PATCH", cookie: meera, json: { status: "offered" } });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error.code, "INVALID_TRANSITION");
    assert.match(res.body.error.message, /applied -> offered/);
  });

  it("rejected -> offered: direct SQL UPDATE fails in the trigger, API returns 409, nothing changes", async () => {
    const rej = await api(`/api/recruiter/applications/${app.id}`, { method: "PATCH", cookie: meera, json: { status: "rejected", note: "Position filled" } });
    assert.equal(rej.status, 200, rej.text);
    const historyBefore = (await db.query("SELECT count(*)::int AS n FROM application_status_history WHERE application_id = $1", [app.id])).rows[0].n;

    await assert.rejects(db.query("UPDATE applications SET status = 'offered' WHERE application_id = $1", [app.id]),
      (err) => err.code === "23514" && /Invalid application status transition: rejected -> offered/.test(err.message));
    await assert.rejects(db.query("SELECT update_application_status($1, 'offered', $2, NULL)", [app.id, meeraId]),
      (err) => err.code === "23514");

    const res = await api(`/api/recruiter/applications/${app.id}`, { method: "PATCH", cookie: meera, json: { status: "offered" } });
    assert.equal(res.status, 409, res.text);
    assert.match(res.body.error.message, /rejected -> offered/);
    assert.ok(res.body.error.details.hint.includes("rejected is final"));

    const after = await db.query(
      "SELECT a.status, (SELECT count(*)::int FROM application_status_history h WHERE h.application_id = a.application_id) AS n FROM applications a WHERE a.application_id = $1", [app.id]);
    assert.deepEqual(after.rows[0], { status: "rejected", n: historyBefore });
  });
});

describe("permissions and application rules", () => {
  let job, candidate;
  before(async () => {
    job = (await createJob(meera, { title: `Permissions test job ${RUN}` })).body.job;
    candidate = await newCandidate("perm", "Python NLP developer with experience in text classification and semantic search.");
  });

  it("recruiter of another company gets 403 on view, edit, status change, delete and applicants", async () => {
    assert.equal((await api(`/api/recruiter/jobs/${job.id}`, { cookie: kavya })).status, 403);
    const edit = await api(`/api/recruiter/jobs/${job.id}`, { method: "PATCH", cookie: kavya, json: { title: "Hijacked" } });
    assert.equal(edit.status, 403, edit.text);
    assert.equal((await api(`/api/recruiter/jobs/${job.id}`, { method: "PATCH", cookie: kavya, json: { status: "closed" } })).status, 403);
    assert.equal((await api(`/api/recruiter/jobs/${job.id}`, { method: "DELETE", cookie: kavya })).status, 403);
    assert.equal((await api(`/api/recruiter/jobs/${job.id}/applications`, { cookie: kavya })).status, 403);
    const row = await db.query("SELECT title, status FROM jobs WHERE job_id = $1", [job.id]);
    assert.deepEqual(row.rows[0], { title: job.title, status: "open" });
    const listed = await api("/api/recruiter/jobs", { cookie: kavya });
    assert.equal(listed.body.jobs.some((j) => j.id === job.id), false);
  });

  it("a recruiter cannot choose the company or recruiter of a new job", async () => {
    const res = await api("/api/recruiter/jobs", { method: "POST", cookie: kavya, json: {
      title: `Spoofed ${RUN}`, description: "x".repeat(60), location: "Pune", companyId: 1, recruiterId: meeraId } });
    assert.equal(res.status, 400, res.text);
  });

  it("duplicate application gets 409 ALREADY_APPLIED and the count does not change", async () => {
    const first = await api("/api/candidate/applications", { method: "POST", cookie: candidate.cookie, json: { jobId: job.id, resumeId: candidate.resumeId } });
    assert.equal(first.status, 201, first.text);
    const count = await applicantCount(job.id);
    const again = await api("/api/candidate/applications", { method: "POST", cookie: candidate.cookie, json: { jobId: job.id, resumeId: candidate.resumeId } });
    assert.equal(again.status, 409, again.text);
    assert.equal(again.body.error.code, "ALREADY_APPLIED");
    assert.equal(await applicantCount(job.id), count);
  });

  it("candidate cannot change an application's status (403) and the status stays the same", async () => {
    const appId = (await db.query("SELECT application_id::int FROM applications WHERE job_id = $1 AND candidate_id = $2", [job.id, candidate.id])).rows[0].application_id;
    const res = await api(`/api/recruiter/applications/${appId}`, { method: "PATCH", cookie: candidate.cookie, json: { status: "shortlisted" } });
    assert.equal(res.status, 403, res.text);
    assert.equal((await api(`/api/recruiter/applications/${appId}`, { method: "PATCH", json: { status: "shortlisted" } })).status, 401);
    const kav = await api(`/api/recruiter/applications/${appId}`, { method: "PATCH", cookie: kavya, json: { status: "shortlisted" } });
    assert.equal(kav.status, 403, kav.text);
    assert.equal((await db.query("SELECT status FROM applications WHERE application_id = $1", [appId])).rows[0].status, "applied");
  });

  it("candidate cannot apply to a closed job (409) or a draft job (404)", async () => {
    const other = await newCandidate("closed", "Python developer focused on NLP pipelines and evaluation of language models.");
    for (const [status, expected, code] of [["closed", 409, "JOB_NOT_OPEN"], ["draft", 404, "NOT_FOUND"]]) {
      const change = await api(`/api/recruiter/jobs/${job.id}`, { method: "PATCH", cookie: meera, json: { status } });
      assert.equal(change.status, 200, change.text);
      const count = await applicantCount(job.id);
      const res = await api("/api/candidate/applications", { method: "POST", cookie: other.cookie, json: { jobId: job.id, resumeId: other.resumeId } });
      assert.equal(res.status, expected, `${status}: ${res.text}`);
      assert.equal(res.body.error.code, code);
      assert.equal(await applicantCount(job.id), count);
    }
    assert.equal((await api(`/api/candidate/jobs/${job.id}`, { cookie: other.cookie })).status, 404, "draft job is hidden from candidates");
    const n = await db.query("SELECT count(*)::int AS n FROM applications WHERE candidate_id = $1", [other.id]);
    assert.equal(n.rows[0].n, 0);
  });

  it("candidate cannot apply with someone else's resume (404)", async () => {
    const reopen = await api(`/api/recruiter/jobs/${job.id}`, { method: "PATCH", cookie: meera, json: { status: "open" } });
    assert.equal(reopen.status, 200, reopen.text);
    const other = await newCandidate("thief", "Python developer focused on NLP pipelines and evaluation of language models.");
    const res = await api("/api/candidate/applications", { method: "POST", cookie: other.cookie, json: { jobId: job.id, resumeId: candidate.resumeId } });
    assert.equal(res.status, 404, res.text);
  });
});

describe("recruiter job CRUD", () => {
  it("edit title and skills re-embeds the job; a status-only change does not", async () => {
    const job = (await createJob(meera, { title: `Edit test job ${RUN}` })).body.job;
    const hash = async () => (await db.query("SELECT source_hash FROM job_embeddings WHERE job_id = $1", [job.id])).rows[0].source_hash;
    const h1 = await hash();
    const edit = await api(`/api/recruiter/jobs/${job.id}`, { method: "PATCH", cookie: meera, json: {
      title: `Edited NLP job ${RUN}`, skills: [{ skillId: skillIds.PyTorch, isRequired: true, minProficiency: 3 }] } });
    assert.equal(edit.status, 200, edit.text);
    assert.equal(edit.body.job.title, `Edited NLP job ${RUN}`);
    assert.deepEqual(edit.body.job.skills.map((s) => s.name), ["PyTorch"]);
    const h2 = await hash();
    assert.notEqual(h2, h1, "embedding text changed, so the job is re-embedded");
    const close = await api(`/api/recruiter/jobs/${job.id}`, { method: "PATCH", cookie: meera, json: { status: "closed" } });
    assert.equal(close.body.job.status, "closed");
    assert.equal(await hash(), h2);
  });

  it("validation (400) and database constraints (400 with the constraint name)", async () => {
    const short = await createJob(meera, { description: "Too short" });
    assert.equal(short.status, 400, short.text);
    assert.ok(short.body.error.details.fieldErrors.description);
    const past = await createJob(meera, { closesAt: "2020-01-01" });
    assert.equal(past.status, 400, past.text);
    assert.equal(past.body.error.details.constraint, "jobs_closes_after_posted_check");
    const badSkill = await createJob(meera, { skills: [{ skillId: 999999999 }] });
    assert.equal(badSkill.status, 400, badSkill.text);
    assert.equal(badSkill.body.error.details.constraint, "job_skills_skill_fkey");
    const left = await db.query("SELECT count(*)::int AS n FROM jobs WHERE title = $1", [`Applied NLP Engineer ${RUN}`]);
    assert.equal(left.rows[0].n, 1, "failed creates rolled back; only the full-flow job exists");
  });

  it("delete: a job without applications is removed (with its embedding); one with applications gets 409", async () => {
    const job = (await createJob(meera, { title: `Delete test job ${RUN}`, status: "draft" })).body.job;
    const del = await api(`/api/recruiter/jobs/${job.id}`, { method: "DELETE", cookie: meera });
    assert.equal(del.status, 200, del.text);
    const gone = await db.query("SELECT (SELECT count(*) FROM jobs WHERE job_id = $1)::int AS j, (SELECT count(*) FROM job_embeddings WHERE job_id = $1)::int AS e, (SELECT count(*) FROM job_skills WHERE job_id = $1)::int AS s", [job.id]);
    assert.deepEqual(gone.rows[0], { j: 0, e: 0, s: 0 });

    const withApps = (await db.query("SELECT job_id::int FROM jobs WHERE title = $1", [`Applied NLP Engineer ${RUN}`])).rows[0].job_id;
    const blocked = await api(`/api/recruiter/jobs/${withApps}`, { method: "DELETE", cookie: meera });
    assert.equal(blocked.status, 409, blocked.text);
    assert.equal(blocked.body.error.code, "JOB_HAS_APPLICATIONS");
  });
});

describe("skill gap (job_skills EXCEPT candidate_skills)", () => {
  const mlJob = async () => (await db.query("SELECT job_id::int FROM jobs WHERE title = 'Machine Learning Engineer'")).rows[0].job_id;
  const userId = async (email) => (await db.query("SELECT user_id::int FROM users WHERE email = $1", [email])).rows[0].user_id;

  it("seeded Aman for the ML Engineer job: has Python (below level), missing NLP and PyTorch", async () => {
    const gap = await getSkillGap(await mlJob(), await userId("aman.malhotra@mail.example"));
    assert.deepEqual(gap.have.map((s) => [s.name, s.proficiency, s.minProficiency, s.meetsLevel]), [["Python", 2, 4, false]]);
    assert.deepEqual(gap.missing.map((s) => s.name), ["Natural Language Processing", "PyTorch"]);
  });

  it("seeded Aditi for the ML Engineer job: has all three at the required level, nothing missing", async () => {
    const gap = await getSkillGap(await mlJob(), await userId("aditi.sharma@mail.example"));
    // Compared as sets: PostgreSQL's collation and JS .sort() order "PyTorch" / "Python" differently.
    assert.deepEqual(gap.have.map((s) => s.name).sort(), ["Natural Language Processing", "PyTorch", "Python"]);
    assert.ok(gap.have.every((s) => s.meetsLevel));
    assert.deepEqual(gap.missing, []);
  });

  it("have + missing is exactly the job's required skills, and the API returns the same lists", async () => {
    const jobId = await mlJob();
    const required = (await db.query(
      "SELECT s.name FROM job_skills js JOIN skills s USING (skill_id) WHERE js.job_id = $1 AND js.is_required ORDER BY s.name", [jobId])).rows.map((r) => r.name);
    const gap = await getSkillGap(jobId, await userId("aman.malhotra@mail.example"));
    assert.deepEqual([...gap.have, ...gap.missing].map((s) => s.name).sort(), required.sort());

    const res = await api(`/api/candidate/jobs/${jobId}`, { cookie: await login("aman.malhotra@mail.example") });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.skillGap, gap);
    assert.equal(res.body.job.application.status, "rejected");
  });
});
