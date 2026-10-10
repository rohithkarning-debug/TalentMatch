// Candidate-module integration tests against the production Next.js server and PostgreSQL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
process.env.TEST_PORT = "3101";
const { makeClient, startServer } = await import("./helpers.js");

const RUN = Date.now().toString(36);
const DEMO_PASSWORD = "TalentMatch@2026";
let server, api, db, candidateCookie, candidateId, candidateEmail;
let uploadedResumeId;

async function login(email, password = DEMO_PASSWORD) {
  const result = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(result.status, 200, result.text);
  return { user: result.body.user, cookie: result.sessionCookie.value };
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
  await db?.query("DELETE FROM users WHERE email LIKE $1", [`candidate.module.${RUN}@test.example`]);
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

  it("uploads and lists a text resume, then deletes it for its owner", async () => {
    const form = new FormData();
    form.append("file", new Blob(["This is a test resume with enough extractable content to satisfy the minimum fifty character rule."], { type: "text/plain" }), "candidate-test.txt");
    const uploaded = await api("/api/candidate/resumes", { method: "POST", cookie: candidateCookie, body: form });
    assert.equal(uploaded.status, 201, uploaded.text);
    uploadedResumeId = uploaded.body.resume.id;
    const list = await api("/api/candidate/resumes", { cookie: candidateCookie });
    assert.ok(list.body.resumes.some((resume) => resume.id === uploadedResumeId));
    const other = await login("aditi.sharma@mail.example");
    assert.equal((await api(`/api/candidate/resumes/${uploadedResumeId}`, { method: "DELETE", cookie: other.cookie })).status, 404);
    assert.equal((await api(`/api/candidate/resumes/${uploadedResumeId}`, { method: "DELETE", cookie: candidateCookie })).status, 200);
    uploadedResumeId = null;
  });
});
