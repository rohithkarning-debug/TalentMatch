// Semantic matching (Stage 5) against the production Next.js server, the real
// database and the real embedding model. No score in here is hard-coded: the
// tests only compare orderings and re-compute similarities in SQL.
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
process.env.TEST_PORT = "3102";
const { makeClient, startServer } = await import("./helpers.js");
const { embedPending, embedJob } = await import("../../src/lib/vector-store.js");
const { getPool } = await import("../../src/lib/db.js");

const RUN = Date.now().toString(36);
const DEMO_PASSWORD = "TalentMatch@2026";
const ML_JOB = "Machine Learning Engineer";
const FRONTEND_JOB = "Frontend Developer (React / Next.js)";
// Seeded candidates grouped by their resume content.
const ML_DATA = ["aditi.sharma", "rohan.verma", "divya.krishnan", "ishita.banerjee", "farhan.qureshi"];
const FRONTEND_ONLY = ["sneha.kulkarni", "vikram.chauhan"];

let server, api, db;
let tempJobId;
const jobIds = {};
const candidateIds = {};

async function login(email, password = DEMO_PASSWORD) {
  const result = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(result.status, 200, result.text);
  return result.sessionCookie.value;
}

async function ranking(jobId, { limit = 100, applicantsOnly = false } = {}) {
  const { rows } = await db.query(
    "SELECT candidate_id::int, full_name, similarity::float8, matched_skills, required_skills, has_applied FROM rank_candidates_for_job($1, $2, $3)",
    [jobId, limit, applicantsOnly]);
  return rows;
}

function printRanking(title, rows) {
  console.log(`\nRanking for "${title}" (similarity = 1 - cosine distance):`);
  rows.forEach((r, i) => console.log(
    `  ${String(i + 1).padStart(2)}. ${r.full_name.padEnd(22)} ${r.similarity.toFixed(4)}  skills ${r.matched_skills}/${r.required_skills}${r.has_applied ? "  (applied)" : ""}`));
}

function assertGroupAbove(rows, higher, lower) {
  const position = (key) => {
    const i = rows.findIndex((r) => r.candidate_id === candidateIds[key]);
    assert.notEqual(i, -1, `${key} missing from ranking`);
    return i;
  };
  const worstHigher = Math.max(...higher.map(position));
  const bestLower = Math.min(...lower.map(position));
  assert.ok(worstHigher < bestLower,
    `expected all of [${higher}] above all of [${lower}]; worst of first group at #${worstHigher + 1}, best of second at #${bestLower + 1}`);
}

before(async () => {
  assert.ok(process.env.AUTH_JWT_SECRET && process.env.DATABASE_URL, "Set .env.local before integration tests");
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  // Same code path as `npm run db:embed`: fills in anything not embedded yet.
  await embedPending();
  for (const title of [ML_JOB, FRONTEND_JOB]) {
    const { rows } = await db.query("SELECT job_id::int FROM jobs WHERE title = $1", [title]);
    assert.equal(rows.length, 1, `seeded job "${title}" not found; run npm run db:seed`);
    jobIds[title] = rows[0].job_id;
  }
  const { rows } = await db.query("SELECT user_id::int, split_part(email, '@', 1) AS key FROM users WHERE email LIKE '%@mail.example'");
  for (const r of rows) candidateIds[r.key] = r.user_id;
  server = await startServer();
  api = makeClient(server.baseUrl);
});

after(async () => {
  if (tempJobId) await db?.query("DELETE FROM jobs WHERE job_id = $1", [tempJobId]);
  const pattern = `matching.${RUN}%@test.example`;
  const files = await db?.query(
    "SELECT r.storage_path FROM resumes r JOIN users u ON u.user_id = r.candidate_id WHERE u.email LIKE $1 AND r.storage_path IS NOT NULL", [pattern]);
  for (const { storage_path: p } of files?.rows || []) await unlink(path.resolve(p)).catch(() => {});
  await db?.query("DELETE FROM users WHERE email LIKE $1", [pattern]);
  await db?.end();
  await getPool().end();
  await server?.stop();
});

describe("semantic ranking sanity (rank_candidates_for_job)", () => {
  it("ranks ML/data candidates above frontend-only candidates for the ML job", async () => {
    const rows = await ranking(jobIds[ML_JOB]);
    printRanking(ML_JOB, rows);
    assertGroupAbove(rows, ML_DATA, FRONTEND_ONLY);
  });

  it("ranks frontend candidates above ML/data candidates for the frontend job", async () => {
    const rows = await ranking(jobIds[FRONTEND_JOB]);
    printRanking(FRONTEND_JOB, rows);
    assertGroupAbove(rows, FRONTEND_ONLY, ML_DATA);
  });

  it("scores equal a direct cosine computation and are sorted descending", async () => {
    const rows = await ranking(jobIds[ML_JOB]);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].similarity >= rows[i].similarity);
    const { rows: direct } = await db.query(
      `SELECT r.candidate_id::int, (1 - (re.embedding <=> je.embedding))::float8 AS cos
         FROM resume_embeddings re JOIN resumes r ON r.resume_id = re.resume_id AND r.is_primary
         CROSS JOIN job_embeddings je WHERE je.job_id = $1`, [jobIds[ML_JOB]]);
    const byCandidate = new Map(direct.map((d) => [d.candidate_id, d.cos]));
    for (const r of rows) assert.ok(Math.abs(r.similarity - byCandidate.get(r.candidate_id)) <= 0.00005, `${r.full_name}`);
  });

  it("applicantsOnly returns exactly the job's applicants", async () => {
    const rows = await ranking(jobIds[ML_JOB], { applicantsOnly: true });
    const { rows: applicants } = await db.query(
      `SELECT a.candidate_id::int FROM applications a
         JOIN resumes r ON r.candidate_id = a.candidate_id AND r.is_primary
         JOIN resume_embeddings re ON re.resume_id = r.resume_id
        WHERE a.job_id = $1 ORDER BY 1`, [jobIds[ML_JOB]]);
    assert.ok(applicants.length > 0);
    assert.deepEqual(rows.map((r) => r.candidate_id).sort((a, b) => a - b), applicants.map((a) => a.candidate_id));
    assert.ok(rows.every((r) => r.has_applied));
  });
});

describe("GET /api/recruiter/jobs/:jobId/matches", () => {
  const url = (jobId, qs = "") => `/api/recruiter/jobs/${jobId}/matches${qs}`;

  it("recruiter of the job's company gets 200 with the database ranking", async () => {
    const cookie = await login("meera.iyer@nimbusanalytics.example");
    const res = await api(url(jobIds[ML_JOB], "?limit=5&applicantsOnly=false"), { cookie });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.job.title, ML_JOB);
    assert.equal(res.body.job.embeddingModel, "sentence-transformers/all-MiniLM-L6-v2");
    assert.equal(res.body.matches.length, 5);
    const expected = (await ranking(jobIds[ML_JOB], { limit: 5 })).map((r) => [r.candidate_id, r.similarity]);
    assert.deepEqual(res.body.matches.map((m) => [m.candidateId, m.similarity]), expected);
    for (const key of ["candidateId", "fullName", "yearsExperience", "similarity", "matchedSkills", "requiredSkills", "hasApplied"]) {
      assert.ok(key in res.body.matches[0], key);
    }
  });

  it("applicantsOnly=true only returns applicants", async () => {
    const cookie = await login("arjun.rao@nimbusanalytics.example"); // other recruiter, same company
    const res = await api(url(jobIds[ML_JOB], "?applicantsOnly=true"), { cookie });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.applicantsOnly, true);
    assert.ok(res.body.matches.length > 0 && res.body.matches.every((m) => m.hasApplied));
  });

  it("recruiter of another company gets 403", async () => {
    const cookie = await login("kavya.menon@kestrellabs.example");
    const res = await api(url(jobIds[ML_JOB]), { cookie });
    assert.equal(res.status, 403, res.text);
    assert.equal(res.body.error.code, "FORBIDDEN");
  });

  it("candidate and admin get 403", async () => {
    for (const email of ["aditi.sharma@mail.example", "admin@talentmatch.example"]) {
      const res = await api(url(jobIds[ML_JOB]), { cookie: await login(email) });
      assert.equal(res.status, 403, `${email}: ${res.text}`);
    }
  });

  it("no cookie gets 401", async () => {
    const res = await api(url(jobIds[ML_JOB]));
    assert.equal(res.status, 401, res.text);
  });

  it("nonexistent or malformed job id gets 404", async () => {
    const cookie = await login("meera.iyer@nimbusanalytics.example");
    for (const id of ["999999999", "abc", "-1"]) {
      const res = await api(url(id), { cookie });
      assert.equal(res.status, 404, `${id}: ${res.text}`);
    }
  });

  it("invalid query parameters get 400", async () => {
    const cookie = await login("meera.iyer@nimbusanalytics.example");
    for (const qs of ["?limit=0", "?limit=51", "?applicantsOnly=yes", "?sort=asc"]) {
      const res = await api(url(jobIds[ML_JOB], qs), { cookie });
      assert.equal(res.status, 400, `${qs}: ${res.text}`);
    }
  });

  it("job without an embedding gets 404 NOT_EMBEDDED; embedding it fixes that; deleting it cascades", async () => {
    const { rows } = await db.query(
      `INSERT INTO jobs (company_id, recruiter_id, title, description, location)
       SELECT r.company_id, r.user_id, $1, $2, 'Bengaluru'
         FROM recruiters r JOIN users u ON u.user_id = r.user_id
        WHERE u.email = 'meera.iyer@nimbusanalytics.example'
       RETURNING job_id::int`,
      [`Matching test job ${RUN}`, "Temporary posting for the matching integration test: Python data pipelines and model evaluation."]);
    tempJobId = rows[0].job_id;
    const cookie = await login("meera.iyer@nimbusanalytics.example");
    const before = await api(url(tempJobId), { cookie });
    assert.equal(before.status, 404, before.text);
    assert.equal(before.body.error.code, "NOT_EMBEDDED");

    await embedJob(tempJobId);
    const afterEmbed = await api(url(tempJobId, "?limit=3"), { cookie });
    assert.equal(afterEmbed.status, 200, afterEmbed.text);
    assert.equal(afterEmbed.body.matches.length, 3);

    await db.query("DELETE FROM jobs WHERE job_id = $1", [tempJobId]);
    const left = await db.query("SELECT count(*)::int AS n FROM job_embeddings WHERE job_id = $1", [tempJobId]);
    assert.equal(left.rows[0].n, 0);
    tempJobId = undefined;
  });
});

describe("resume upload embeds the resume", () => {
  it("upload -> embedded with model name; re-embeddable; delete removes the embedding", async () => {
    const reg = await api("/api/auth/register", { method: "POST", json: { fullName: "Matching Test", email: `matching.${RUN}@test.example`, password: "Testpass123" } });
    assert.equal(reg.status, 201, reg.text);
    const cookie = reg.sessionCookie.value;
    const form = new FormData();
    form.append("file", new Blob(["Machine learning engineer who trains NLP models in PyTorch and deploys them with Docker."], { type: "text/plain" }), "ml.txt");
    const up = await api("/api/candidate/resumes", { method: "POST", body: form, cookie });
    assert.equal(up.status, 201, up.text);
    assert.equal(up.body.resume.isEmbedded, true);
    const resumeId = up.body.resume.id;

    const stored = await db.query("SELECT model_name, chunk_count, vector_dims(embedding) AS dims FROM resume_embeddings WHERE resume_id = $1", [resumeId]);
    assert.deepEqual(stored.rows[0], { model_name: "sentence-transformers/all-MiniLM-L6-v2", chunk_count: 1, dims: 384 });
    const list = await api("/api/candidate/resumes", { cookie });
    assert.equal(list.body.resumes.find((r) => Number(r.id) === Number(resumeId)).isEmbedded, true);

    // Simulate a failed embedding, then repair it the way db:embed does.
    await db.query("DELETE FROM resume_embeddings WHERE resume_id = $1", [resumeId]);
    const missing = await api("/api/candidate/resumes", { cookie });
    assert.equal(missing.body.resumes.find((r) => Number(r.id) === Number(resumeId)).isEmbedded, false);
    const summary = await embedPending();
    assert.ok(summary.resumes.embedded >= 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM resume_embeddings WHERE resume_id = $1", [resumeId])).rows[0].n, 1);

    const del = await api(`/api/candidate/resumes/${resumeId}`, { method: "DELETE", cookie });
    assert.equal(del.status, 200, del.text);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM resume_embeddings WHERE resume_id = $1", [resumeId])).rows[0].n, 0);
  });
});
