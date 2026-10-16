// Stage 7: interviews, offers and notifications, tested against the
// production Next.js server and the real database. Every check of "what
// changed" reads the database directly, not only the API response.
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
process.env.TEST_PORT = "3104";
const { makeClient, startServer } = await import("./helpers.js");
const { makeOffer } = await import("../../src/lib/offers.js");
const { getPool } = await import("../../src/lib/db.js");
const { todayInIndia } = await import("../../src/lib/validation/pipeline.js");

const RUN = Date.now().toString(36);
const DEMO_PASSWORD = "TalentMatch@2026";
const MEERA = "meera.iyer@nimbusanalytics.example"; // Nimbus Analytics
const KAVYA = "kavya.menon@kestrellabs.example";    // Kestrel Software Labs
const ARJUN = "arjun.rao@nimbusanalytics.example";   // Nimbus Analytics (Meera's colleague)
const EMAIL_PATTERN = `pipeline.${RUN}.%@test.example`;

let server, api, db;
let meera, kavya, arjun, meeraId, arjunId, job, arjunJob;
const cand = {}; // tag -> { id, cookie, resumeId, applicationId }

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const inSeconds = (s) => new Date(Date.now() + s * 1000).toISOString();
// Interviews can only be completed once their time has passed (migration
// 021), so a test schedules one a few seconds ahead and waits for it.
const waitUntilPassed = (iso) => new Promise((r) => setTimeout(r, Math.max(0, new Date(iso).getTime() - Date.now() + 500)));
const addDays = (n) => {
  const d = new Date(`${todayInIndia()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const offerBody = () => ({ salaryOffered: 2_200_000, joiningDate: addDays(30), expiresOn: addDays(7) });
const videoInterview = (hours = 48) => ({ scheduledAt: inHours(hours), mode: "video", locationOrLink: "https://meet.nimbusanalytics.example/stage7" });

async function login(email, password = DEMO_PASSWORD) {
  const result = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(result.status, 200, result.text);
  return result.sessionCookie.value;
}

// Register, upload a resume, apply to the test job; optionally shortlist.
async function newApplicant(tag, { shortlist = true, jobId = job.id } = {}) {
  const reg = await api("/api/auth/register", { method: "POST", json: {
    fullName: `Pipeline Candidate ${tag}`, email: `pipeline.${RUN}.${tag}@test.example`, password: "Testpass123" } });
  assert.equal(reg.status, 201, reg.text);
  const cookie = reg.sessionCookie.value;
  const form = new FormData();
  form.append("file", new Blob([`Data engineer ${tag}: I build batch and streaming pipelines in Python and SQL, model warehouses and monitor data quality.`],
    { type: "text/plain" }), `${tag}.txt`);
  const up = await api("/api/candidate/resumes", { method: "POST", body: form, cookie });
  assert.equal(up.status, 201, up.text);
  const applied = await api("/api/candidate/applications", { method: "POST", cookie,
    json: { jobId, resumeId: Number(up.body.resume.id) } });
  assert.equal(applied.status, 201, applied.text);
  const applicationId = applied.body.application.id;
  if (shortlist) {
    const res = await api(`/api/recruiter/applications/${applicationId}`, { method: "PATCH", cookie: meera, json: { status: "shortlisted" } });
    assert.equal(res.status, 200, res.text);
  }
  cand[tag] = { id: reg.body.user.id, cookie, applicationId };
  return cand[tag];
}

// Everything the offer / interview transactions can touch, for one application.
async function snapshot(applicationId) {
  const { rows } = await db.query(
    `SELECT a.status,
            (SELECT count(*)::int FROM application_status_history h WHERE h.application_id = a.application_id) AS history,
            (SELECT count(*)::int FROM notifications n WHERE n.related_application_id = a.application_id) AS notifications,
            (SELECT count(*)::int FROM offers o WHERE o.application_id = a.application_id) AS offers,
            (SELECT count(*)::int FROM interviews i WHERE i.application_id = a.application_id) AS interviews
       FROM applications a WHERE a.application_id = $1`, [applicationId]);
  return rows[0];
}

const notificationTypes = async (userId, applicationId) => (await db.query(
  `SELECT type FROM notifications WHERE user_id = $1 AND related_application_id = $2 ORDER BY notification_id`,
  [userId, applicationId])).rows.map((r) => r.type);

before(async () => {
  assert.ok(process.env.AUTH_JWT_SECRET && process.env.DATABASE_URL, "Set .env.local before integration tests");
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  meeraId = (await db.query("SELECT user_id::int FROM users WHERE email = $1", [MEERA])).rows[0].user_id;
  server = await startServer();
  api = makeClient(server.baseUrl);
  meera = await login(MEERA);
  kavya = await login(KAVYA);
  arjun = await login(ARJUN);
  arjunId = (await db.query("SELECT user_id::int FROM users WHERE email = $1", [ARJUN])).rows[0].user_id;
  const res = await api("/api/recruiter/jobs", { method: "POST", cookie: meera, json: {
    title: `Data Engineer ${RUN}`, location: "Bengaluru", workMode: "hybrid", status: "open",
    description: "Build reliable batch and streaming data pipelines in Python and SQL, model the warehouse and monitor data quality." } });
  assert.equal(res.status, 201, res.text);
  job = res.body.job;
  for (const tag of ["main", "rollback", "expiry"]) await newApplicant(tag);
  await newApplicant("applied", { shortlist: false });
});

after(async () => {
  const files = await db?.query(
    "SELECT r.storage_path FROM resumes r JOIN users u ON u.user_id = r.candidate_id WHERE u.email LIKE $1 AND r.storage_path IS NOT NULL", [EMAIL_PATTERN]);
  for (const { storage_path: p } of files?.rows || []) await unlink(path.resolve(p)).catch(() => {});
  // Candidates first: applications, interviews, offers and their
  // notifications go with them (ON DELETE CASCADE); then Meera's
  // notifications about them, then the job.
  await db?.query("DELETE FROM users WHERE email LIKE $1", [EMAIL_PATTERN]);
  await db?.query("DELETE FROM notifications WHERE title LIKE $1", [`%${RUN}%`]);
  for (const j of [job, arjunJob]) if (j) await db?.query("DELETE FROM jobs WHERE job_id = $1", [j.id]);
  await db?.end();
  await getPool().end();
  await server?.stop();
});

describe("interviews", () => {
  it("scheduling the first interview moves shortlisted -> interviewed in the same transaction, with history and notification", async () => {
    const { applicationId, id: candidateId } = cand.main;
    const beforeState = await snapshot(applicationId);
    assert.equal(beforeState.status, "shortlisted");

    const res = await api(`/api/recruiter/applications/${applicationId}/interviews`, { method: "POST", cookie: meera, json: videoInterview() });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.applicationStatus, "interviewed");
    assert.equal(res.body.interview.roundNo, 1);
    assert.equal(res.body.interview.status, "scheduled");

    const afterState = await snapshot(applicationId);
    assert.equal(afterState.status, "interviewed");
    assert.equal(afterState.history, beforeState.history + 1);
    const { rows: [h] } = await db.query(
      `SELECT old_status, new_status, changed_by::int, note FROM application_status_history
        WHERE application_id = $1 ORDER BY history_id DESC LIMIT 1`, [applicationId]);
    assert.deepEqual(h, { old_status: "shortlisted", new_status: "interviewed", changed_by: meeraId, note: "Interview round 1 scheduled" });
    const types = await notificationTypes(candidateId, applicationId);
    assert.deepEqual(types.slice(-2), ["status_changed", "interview_scheduled"]);
    const { rows: [iv] } = await db.query("SELECT interviewer_id::int, mode, location_or_link FROM interviews WHERE interview_id = $1", [res.body.interview.id]);
    assert.deepEqual(iv, { interviewer_id: meeraId, mode: "video", location_or_link: "https://meet.nimbusanalytics.example/stage7" });
  });

  it("round 2 gets round_no 2 and leaves the status (and history) unchanged", async () => {
    const { applicationId } = cand.main;
    const beforeState = await snapshot(applicationId);
    const res = await api(`/api/recruiter/applications/${applicationId}/interviews`, { method: "POST", cookie: meera,
      json: { scheduledAt: inHours(72), mode: "onsite", locationOrLink: "Nimbus Analytics, Koramangala office", durationMinutes: 90 } });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.interview.roundNo, 2);
    const afterState = await snapshot(applicationId);
    assert.equal(afterState.status, "interviewed");
    assert.equal(afterState.history, beforeState.history);
    assert.equal(afterState.interviews, 2);
  });

  it("candidate sees their upcoming interviews, without the recruiter's rating or feedback", async () => {
    const res = await api("/api/candidate/interviews", { cookie: cand.main.cookie });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.interviews.map((i) => [i.roundNo, i.status, i.isUpcoming]), [[1, "scheduled", true], [2, "scheduled", true]]);
    for (const i of res.body.interviews) {
      assert.equal("rating" in i, false);
      assert.equal("feedback" in i, false);
    }
    const other = await api("/api/candidate/interviews", { cookie: cand.applied.cookie });
    assert.deepEqual(other.body.interviews, []);
  });

  it("reschedule and cancel notify the candidate; a cancelled interview cannot change again (409 from the trigger)", async () => {
    const { rows: [round2] } = await db.query("SELECT interview_id::int AS id FROM interviews WHERE application_id = $1 AND round_no = 2", [cand.main.applicationId]);
    const newTime = inHours(96);
    const moved = await api(`/api/recruiter/interviews/${round2.id}`, { method: "PATCH", cookie: meera, json: { action: "reschedule", scheduledAt: newTime } });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(new Date(moved.body.interview.scheduledAt).toISOString(), newTime);

    const cancelled = await api(`/api/recruiter/interviews/${round2.id}`, { method: "PATCH", cookie: meera, json: { action: "cancel", reason: "Panel unavailable" } });
    assert.equal(cancelled.status, 200, cancelled.text);
    assert.equal(cancelled.body.interview.status, "cancelled");

    const again = await api(`/api/recruiter/interviews/${round2.id}`, { method: "PATCH", cookie: meera, json: { action: "reschedule", scheduledAt: inHours(100) } });
    assert.equal(again.status, 409, again.text);
    assert.equal(again.body.error.code, "RULE_VIOLATION");
    assert.match(again.body.error.message, /already cancelled/);

    // Regression (migration 019): cancelling twice used to return 200 and
    // notify the candidate again.
    const twice = await api(`/api/recruiter/interviews/${round2.id}`, { method: "PATCH", cookie: meera, json: { action: "cancel" } });
    assert.equal(twice.status, 409, twice.text);

    const types = await notificationTypes(cand.main.id, cand.main.applicationId);
    assert.deepEqual(types.slice(-2), ["interview_updated", "interview_updated"]);
    assert.equal(types.filter((t) => t === "interview_updated").length, 2);
  });

  // Stage 9 regression (migration 021): completing a future interview used to pass.
  it("a future interview cannot be marked completed (409 from trg_interviews_guard); once its time has passed it can", async () => {
    const { rows: [round1] } = await db.query("SELECT interview_id::int AS id FROM interviews WHERE application_id = $1 AND round_no = 1", [cand.main.applicationId]);
    const early = await api(`/api/recruiter/interviews/${round1.id}`, { method: "PATCH", cookie: meera,
      json: { action: "complete", rating: 5, feedback: "Too early" } });
    assert.equal(early.status, 409, early.text);
    assert.equal(early.body.error.code, "RULE_VIOLATION");
    assert.match(early.body.error.message, /cannot be marked completed before its scheduled time/);
    const { rows: [still] } = await db.query("SELECT status, rating, feedback FROM interviews WHERE interview_id = $1", [round1.id]);
    assert.deepEqual(still, { status: "scheduled", rating: null, feedback: null });

    const soon = inSeconds(3);
    const scheduled = await api(`/api/recruiter/applications/${cand.main.applicationId}/interviews`, { method: "POST", cookie: meera,
      json: { scheduledAt: soon, mode: "phone" } });
    assert.equal(scheduled.status, 201, scheduled.text);
    await waitUntilPassed(soon);
    const res = await api(`/api/recruiter/interviews/${scheduled.body.interview.id}`, { method: "PATCH", cookie: meera,
      json: { action: "complete", rating: 5, feedback: "Strong SQL and pipeline design." } });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.interview.status, res.body.interview.rating], ["completed", 5]);
  });

  it("the database refuses a future 'completed' / 'no_show' and 'move into the past + complete' in one UPDATE, even without the API", async () => {
    const { rows: [round1] } = await db.query("SELECT interview_id::int AS id FROM interviews WHERE application_id = $1 AND round_no = 1", [cand.main.applicationId]);
    for (const status of ["completed", "no_show"]) {
      await assert.rejects(db.query("UPDATE interviews SET status = $2 WHERE interview_id = $1", [round1.id, status]),
        (err) => err.code === "23514" && !err.constraint && new RegExp(`cannot be marked ${status} before its scheduled time`).test(err.message));
    }
    await assert.rejects(db.query(
      "UPDATE interviews SET scheduled_at = now() - interval '1 hour', status = 'completed', rating = 4 WHERE interview_id = $1", [round1.id]),
      (err) => /cannot be rescheduled and marked completed in the same change/.test(err.message));
    const { rows: [still] } = await db.query("SELECT status, rating FROM interviews WHERE interview_id = $1", [round1.id]);
    assert.deepEqual(still, { status: "scheduled", rating: null });
  });

  it("rating outside 1-5 is rejected by the API (400) and by the database CHECK", async () => {
    // Scheduled a few seconds ahead so that, once that time passes, the
    // completion rule is satisfied and only the rating CHECK can fail.
    const soon = inSeconds(3);
    await api(`/api/recruiter/applications/${cand.rollback.applicationId}/interviews`, { method: "POST", cookie: meera,
      json: { scheduledAt: soon, mode: "phone" } }).then((r) => assert.equal(r.status, 201, r.text));
    await waitUntilPassed(soon);
    const { rows: [iv] } = await db.query("SELECT interview_id::int AS id FROM interviews WHERE application_id = $1", [cand.rollback.applicationId]);
    for (const rating of [0, 6]) {
      const res = await api(`/api/recruiter/interviews/${iv.id}`, { method: "PATCH", cookie: meera, json: { action: "complete", rating, feedback: "x" } });
      assert.equal(res.status, 400, res.text);
    }
    await assert.rejects(db.query("UPDATE interviews SET status = 'completed', rating = 6 WHERE interview_id = $1", [iv.id]),
      (err) => err.code === "23514" && err.constraint === "interviews_rating_check");
    const { rows: [still] } = await db.query("SELECT status, rating FROM interviews WHERE interview_id = $1", [iv.id]);
    assert.deepEqual(still, { status: "scheduled", rating: null });
  });

  it("an interview in the past is rejected by the API (400) and by trg_interviews_guard", async () => {
    const res = await api(`/api/recruiter/applications/${cand.expiry.applicationId}/interviews`, { method: "POST", cookie: meera, json: videoInterview(-2) });
    assert.equal(res.status, 400, res.text);
    assert.match(JSON.stringify(res.body.error.details), /in the future/);
    await assert.rejects(db.query(
      `INSERT INTO interviews (application_id, round_no, scheduled_at, mode, location_or_link)
       VALUES ($1, 1, now() - interval '1 day', 'video', 'https://x.example')`, [cand.expiry.applicationId]),
      (err) => err.code === "23514" && /Interview must be scheduled in the future/.test(err.message));
    const { rows: [iv] } = await db.query("SELECT interview_id::int AS id FROM interviews WHERE application_id = $1", [cand.rollback.applicationId]);
    await assert.rejects(db.query("UPDATE interviews SET scheduled_at = now() - interval '1 hour' WHERE interview_id = $1", [iv.id]),
      (err) => /rescheduled to a future time/.test(err.message));
    assert.equal((await snapshot(cand.expiry.applicationId)).interviews, 0);
  });

  it("video without a link is rejected by the API and by interviews_location_required_check", async () => {
    const res = await api(`/api/recruiter/applications/${cand.expiry.applicationId}/interviews`, { method: "POST", cookie: meera,
      json: { scheduledAt: inHours(10), mode: "video" } });
    assert.equal(res.status, 400, res.text);
    await assert.rejects(db.query(
      `INSERT INTO interviews (application_id, round_no, scheduled_at, mode) VALUES ($1, 1, now() + interval '1 day', 'onsite')`,
      [cand.expiry.applicationId]), (err) => err.constraint === "interviews_location_required_check");
  });

  it("an 'applied' application cannot get an interview (trigger, 409); nothing is saved", async () => {
    const beforeState = await snapshot(cand.applied.applicationId);
    const res = await api(`/api/recruiter/applications/${cand.applied.applicationId}/interviews`, { method: "POST", cookie: meera, json: videoInterview() });
    assert.equal(res.status, 409, res.text);
    assert.match(res.body.error.message, /shortlisted or interviewed/);
    assert.deepEqual(await snapshot(cand.applied.applicationId), beforeState);
  });
});

describe("offers: the make-offer transaction", () => {
  let offerId;

  it("success: offer row + 'offered' (history by trigger) + notifications, all together", async () => {
    const { applicationId, id: candidateId } = cand.main;
    const beforeState = await snapshot(applicationId);
    const res = await api(`/api/recruiter/applications/${applicationId}/offer`, { method: "POST", cookie: meera, json: offerBody() });
    assert.equal(res.status, 201, res.text);
    offerId = res.body.offer.id;
    assert.deepEqual([res.body.offer.status, res.body.offer.salaryOffered, res.body.offer.currency], ["pending", 2_200_000, "INR"]);

    const afterState = await snapshot(applicationId);
    assert.deepEqual(afterState, { ...beforeState, status: "offered", history: beforeState.history + 1,
      offers: 1, notifications: beforeState.notifications + 2 });
    const { rows: [h] } = await db.query(
      "SELECT old_status, new_status, changed_by::int, note FROM application_status_history WHERE application_id = $1 ORDER BY history_id DESC LIMIT 1", [applicationId]);
    assert.deepEqual(h, { old_status: "interviewed", new_status: "offered", changed_by: meeraId, note: "Offer made" });
    assert.deepEqual((await notificationTypes(candidateId, applicationId)).slice(-2), ["status_changed", "offer_made"]);
  });

  it("forced rollback: a second offer (UNIQUE violation) is 409 and changes nothing", async () => {
    const beforeState = await snapshot(cand.main.applicationId);
    const res = await api(`/api/recruiter/applications/${cand.main.applicationId}/offer`, { method: "POST", cookie: meera,
      json: { ...offerBody(), salaryOffered: 9_999_999 } });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error.code, "OFFER_EXISTS");
    assert.deepEqual(await snapshot(cand.main.applicationId), beforeState);
    const { rows } = await db.query("SELECT salary_offered::float8 AS s FROM offers WHERE application_id = $1", [cand.main.applicationId]);
    assert.deepEqual(rows, [{ s: 2_200_000 }]);
  });

  it("forced rollback after the status change: the offer row already exists, so the status move, its history row and notification are undone", async () => {
    // An 'interviewed' application that already has an offer row (as if a
    // colleague's offer committed a moment earlier). Step 2 (status ->
    // offered, history, notification) succeeds; step 3 hits the UNIQUE
    // constraint; ROLLBACK must undo step 2.
    const { applicationId } = cand.rollback;
    await db.query(
      "INSERT INTO offers (application_id, salary_offered, joining_date, expires_on) VALUES ($1, 1500000, $2, $3)",
      [applicationId, addDays(40), addDays(5)]);
    const beforeState = await snapshot(applicationId);
    assert.equal(beforeState.status, "interviewed");
    const res = await api(`/api/recruiter/applications/${applicationId}/offer`, { method: "POST", cookie: meera, json: offerBody() });
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(await snapshot(applicationId), beforeState);
    await db.query("DELETE FROM offers WHERE application_id = $1", [applicationId]);
  });

  it("forced rollback at the last step (notification fails): no offer, status still interviewed, no history, no notification", async () => {
    const { applicationId } = cand.rollback;
    const beforeState = await snapshot(applicationId);
    await assert.rejects(
      makeOffer({ id: meeraId, role: "recruiter" }, applicationId, { ...offerBody(), currency: "INR" },
        { notification: () => ({ title: "   ", message: "fails the notifications_title_not_blank_check" }) }),
      (err) => err.code === "23514" && err.constraint === "notifications_title_not_blank_check");
    assert.deepEqual(await snapshot(applicationId), beforeState);
  });

  it("'offered' without an offer is refused at COMMIT by the deferred trigger (SQL and API)", async () => {
    const { applicationId } = cand.rollback;
    const beforeState = await snapshot(applicationId);
    await assert.rejects(db.query("SELECT update_application_status($1, 'offered', $2, NULL)", [applicationId, meeraId]),
      (err) => err.code === "23514" && /cannot be offered without a pending offer/.test(err.message));
    const res = await api(`/api/recruiter/applications/${applicationId}`, { method: "PATCH", cookie: meera, json: { status: "offered" } });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error.code, "RULE_VIOLATION");
    assert.deepEqual(await snapshot(applicationId), beforeState);
  });

  it("an offer on an 'applied' application is rejected by the transition rule (409), nothing saved", async () => {
    const beforeState = await snapshot(cand.applied.applicationId);
    const res = await api(`/api/recruiter/applications/${cand.applied.applicationId}/offer`, { method: "POST", cookie: meera, json: offerBody() });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error.code, "INVALID_TRANSITION");
    assert.match(res.body.error.message, /applied -> offered/);
    assert.deepEqual(await snapshot(cand.applied.applicationId), beforeState);
  });

  it("offer dates are validated by the API (400) and the database (trg_offers_guard)", async () => {
    const res = await api(`/api/recruiter/applications/${cand.rollback.applicationId}/offer`, { method: "POST", cookie: meera,
      json: { ...offerBody(), expiresOn: addDays(-1) } });
    assert.equal(res.status, 400, res.text);
    await assert.rejects(db.query(
      "INSERT INTO offers (application_id, salary_offered, joining_date, expires_on) VALUES ($1, 100, local_today(), local_today())",
      [cand.rollback.applicationId]), (err) => /Joining date must be after today/.test(err.message));
  });

  describe("candidate response", () => {
    it("another candidate gets 404 and the offer stays pending; recruiters cannot use the candidate route (403)", async () => {
      const res = await api(`/api/candidate/offers/${offerId}/respond`, { method: "POST", cookie: cand.applied.cookie, json: { decision: "accept" } });
      assert.equal(res.status, 404, res.text);
      const asRecruiter = await api(`/api/candidate/offers/${offerId}/respond`, { method: "POST", cookie: meera, json: { decision: "accept" } });
      assert.equal(asRecruiter.status, 403);
      const list = await api("/api/candidate/offers", { cookie: cand.applied.cookie });
      assert.deepEqual(list.body.offers, []);
      assert.equal((await db.query("SELECT status FROM offers WHERE offer_id = $1", [offerId])).rows[0].status, "pending");
    });

    it("the candidate accepts: offer accepted + responded_at, recruiter notified, in one transaction", async () => {
      const list = await api("/api/candidate/offers", { cookie: cand.main.cookie });
      assert.deepEqual(list.body.offers.map((o) => [o.id, o.status, o.canRespond, o.isExpired]), [[offerId, "pending", true, false]]);
      const res = await api(`/api/candidate/offers/${offerId}/respond`, { method: "POST", cookie: cand.main.cookie, json: { decision: "accept" } });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.offer.status, "accepted");
      assert.ok(res.body.offer.respondedAt);
      assert.deepEqual(await notificationTypes(meeraId, cand.main.applicationId), ["application_submitted", "offer_responded"]);
      assert.equal((await snapshot(cand.main.applicationId)).status, "offered");
    });

    it("responding twice is 409 (only a pending offer can change), and sends no second notification", async () => {
      const res = await api(`/api/candidate/offers/${offerId}/respond`, { method: "POST", cookie: cand.main.cookie, json: { decision: "decline" } });
      assert.equal(res.status, 409, res.text);
      assert.match(res.body.error.message, /already accepted/);
      // Regression (migration 019): accepting an accepted offer used to pass.
      const again = await api(`/api/candidate/offers/${offerId}/respond`, { method: "POST", cookie: cand.main.cookie, json: { decision: "accept" } });
      assert.equal(again.status, 409, again.text);
      assert.deepEqual(await notificationTypes(meeraId, cand.main.applicationId), ["application_submitted", "offer_responded"]);
    });

    it("an expired offer cannot be accepted (409 from the trigger); after an extension the candidate can decline", async () => {
      const { applicationId, cookie } = cand.expiry;
      await api(`/api/recruiter/applications/${applicationId}/interviews`, { method: "POST", cookie: meera, json: videoInterview(5) })
        .then((r) => assert.equal(r.status, 201, r.text));
      const made = await api(`/api/recruiter/applications/${applicationId}/offer`, { method: "POST", cookie: meera, json: offerBody() });
      assert.equal(made.status, 201, made.text);
      const id = made.body.offer.id;
      // Simulate time passing: the offer expired yesterday (India date).
      await db.query("UPDATE offers SET expires_on = local_today() - 1 WHERE offer_id = $1", [id]);

      const list = await api("/api/candidate/offers", { cookie });
      assert.deepEqual(list.body.offers.map((o) => [o.canRespond, o.isExpired]), [[false, true]]);
      const notificationsBefore = (await snapshot(applicationId)).notifications;
      const res = await api(`/api/candidate/offers/${id}/respond`, { method: "POST", cookie, json: { decision: "accept" } });
      assert.equal(res.status, 409, res.text);
      assert.match(res.body.error.message, /expired on/);
      const { rows: [o] } = await db.query("SELECT status, responded_at FROM offers WHERE offer_id = $1", [id]);
      assert.deepEqual(o, { status: "pending", responded_at: null });
      assert.equal((await snapshot(applicationId)).notifications, notificationsBefore);

      await db.query("UPDATE offers SET expires_on = local_today() WHERE offer_id = $1", [id]);
      const declined = await api(`/api/candidate/offers/${id}/respond`, { method: "POST", cookie, json: { decision: "decline" } });
      assert.equal(declined.status, 200, declined.text);
      assert.equal(declined.body.offer.status, "declined");
      const { rows: [n] } = await db.query(
        "SELECT title FROM notifications WHERE user_id = $1 AND related_application_id = $2 AND type = 'offer_responded'", [meeraId, applicationId]);
      assert.match(n.title, /^Offer declined/);
    });
  });

  describe("withdraw", () => {
    let withdrawId;
    it("recruiter withdraws a pending offer: offer withdrawn, application offered -> rejected, candidate notified", async () => {
      const { applicationId, id: candidateId } = cand.rollback;
      const made = await api(`/api/recruiter/applications/${applicationId}/offer`, { method: "POST", cookie: meera, json: offerBody() });
      assert.equal(made.status, 201, made.text);
      withdrawId = made.body.offer.id;

      const other = await api(`/api/recruiter/offers/${withdrawId}/withdraw`, { method: "POST", cookie: kavya });
      assert.equal(other.status, 403, other.text);

      const res = await api(`/api/recruiter/offers/${withdrawId}/withdraw`, { method: "POST", cookie: meera });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.offer.status, "withdrawn");
      assert.equal((await snapshot(applicationId)).status, "rejected");
      assert.deepEqual((await notificationTypes(candidateId, applicationId)).slice(-2), ["status_changed", "offer_withdrawn"]);
      const listed = await api("/api/recruiter/offers", { cookie: meera });
      assert.equal(listed.body.offers.find((o) => o.id === withdrawId).status, "withdrawn");
    });

    it("withdrawing again or withdrawing an accepted offer is 409", async () => {
      const notificationsBefore = (await snapshot(cand.rollback.applicationId)).notifications;
      const again = await api(`/api/recruiter/offers/${withdrawId}/withdraw`, { method: "POST", cookie: meera });
      assert.equal(again.status, 409, again.text);
      assert.match(again.body.error.message, /already withdrawn/);
      assert.equal((await snapshot(cand.rollback.applicationId)).notifications, notificationsBefore);
      const accepted = await api(`/api/recruiter/offers/${offerId}/withdraw`, { method: "POST", cookie: meera });
      assert.equal(accepted.status, 409, accepted.text);
      assert.match(accepted.body.error.message, /already accepted/);
    });
  });
});

// Stage 9 regression (migration 020): rejecting an 'offered' application
// through the status dropdown used to leave its offer 'pending'.
describe("rejecting an offered application withdraws its pending offer (trg_applications_withdraw_offer)", () => {
  async function offeredApplicant(tag) {
    const c = await newApplicant(tag);
    await api(`/api/recruiter/applications/${c.applicationId}/interviews`, { method: "POST", cookie: meera, json: videoInterview(6) })
      .then((r) => assert.equal(r.status, 201, r.text));
    const made = await api(`/api/recruiter/applications/${c.applicationId}/offer`, { method: "POST", cookie: meera, json: offerBody() });
    assert.equal(made.status, 201, made.text);
    return { ...c, offerId: made.body.offer.id };
  }
  const offerStatus = async (offerId) => (await db.query("SELECT status FROM offers WHERE offer_id = $1", [offerId])).rows[0].status;

  it("status PATCH offered -> rejected: offer becomes withdrawn in the same transaction, candidate notified once, cannot accept", async () => {
    const c = await offeredApplicant("rejectapi");
    const res = await api(`/api/recruiter/applications/${c.applicationId}`, { method: "PATCH", cookie: meera,
      json: { status: "rejected", note: "Position filled" } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.application.status, "rejected");
    assert.equal(await offerStatus(c.offerId), "withdrawn");
    // The trigger's notice is written during the UPDATE, before the function's
    // own 'status_changed' row, so compare without order.
    assert.deepEqual((await notificationTypes(c.id, c.applicationId)).slice(-2).sort(), ["offer_withdrawn", "status_changed"]);
    assert.equal((await notificationTypes(c.id, c.applicationId)).filter((t) => t === "offer_withdrawn").length, 1);
    const { rows: [{ n }] } = await db.query(
      "SELECT count(*)::int AS n FROM offers o JOIN applications a USING (application_id) WHERE a.status = 'rejected' AND o.status = 'pending'");
    assert.equal(n, 0, "no pending offer may stay attached to a rejected application");

    const list = await api("/api/candidate/offers", { cookie: c.cookie });
    assert.deepEqual(list.body.offers.map((o) => [o.status, o.canRespond]), [["withdrawn", false]]);
    const accept = await api(`/api/candidate/offers/${c.offerId}/respond`, { method: "POST", cookie: c.cookie, json: { decision: "accept" } });
    assert.equal(accept.status, 409, accept.text);
  });

  it("update_application_status() from SQL does the same; a ROLLBACK undoes both the reject and the withdrawal", async () => {
    const c = await offeredApplicant("rejectsql");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT update_application_status($1, 'rejected', $2, 'rolled back on purpose')", [c.applicationId, meeraId]);
      const inside = await client.query("SELECT status FROM offers WHERE offer_id = $1", [c.offerId]);
      assert.equal(inside.rows[0].status, "withdrawn");
    } finally {
      // Always roll back, also when an assertion above fails: a pooled client
      // returned mid-transaction would swallow the after() cleanup.
      await client.query("ROLLBACK");
      client.release();
    }
    assert.equal((await snapshot(c.applicationId)).status, "offered");
    assert.equal(await offerStatus(c.offerId), "pending");

    await db.query("SELECT update_application_status($1, 'rejected', $2, 'Rejected from psql')", [c.applicationId, meeraId]);
    assert.equal((await snapshot(c.applicationId)).status, "rejected");
    assert.equal(await offerStatus(c.offerId), "withdrawn");
  });

  it("a declined offer is a final record: rejecting its application leaves it 'declined' and sends no withdrawal notice", async () => {
    const { applicationId, id: candidateId } = cand.expiry; // its offer was declined above
    const { rows: [o] } = await db.query("SELECT offer_id::int AS id, status FROM offers WHERE application_id = $1", [applicationId]);
    assert.equal(o.status, "declined");
    const res = await api(`/api/recruiter/applications/${applicationId}`, { method: "PATCH", cookie: meera, json: { status: "rejected" } });
    assert.equal(res.status, 200, res.text);
    assert.equal(await offerStatus(o.id), "declined");
    assert.equal((await notificationTypes(candidateId, applicationId)).includes("offer_withdrawn"), false);
  });
});

describe("offer response notifies the job poster and the offer maker", () => {
  it("Arjun posted the job, Meera made the offer: both are told, nobody else", async () => {
    const res = await api("/api/recruiter/jobs", { method: "POST", cookie: arjun, json: {
      title: `Analytics Engineer ${RUN}`, location: "Pune", workMode: "remote", status: "open",
      description: "Own the analytics layer: dbt-style SQL models, data tests and dashboards that the business trusts every morning." } });
    assert.equal(res.status, 201, res.text);
    arjunJob = res.body.job;
    const c = await newApplicant("colleague", { jobId: arjunJob.id });
    await api(`/api/recruiter/applications/${c.applicationId}/interviews`, { method: "POST", cookie: meera, json: videoInterview(8) })
      .then((r) => assert.equal(r.status, 201, r.text));
    const made = await api(`/api/recruiter/applications/${c.applicationId}/offer`, { method: "POST", cookie: meera, json: offerBody() });
    assert.equal(made.status, 201, made.text);
    const accepted = await api(`/api/candidate/offers/${made.body.offer.id}/respond`, { method: "POST", cookie: c.cookie, json: { decision: "accept" } });
    assert.equal(accepted.status, 200, accepted.text);
    const { rows } = await db.query(
      "SELECT user_id::int FROM notifications WHERE related_application_id = $1 AND type = 'offer_responded' ORDER BY user_id", [c.applicationId]);
    assert.deepEqual(rows.map((r) => r.user_id), [meeraId, arjunId].sort((a, b) => a - b));
  });
});

describe("permissions", () => {
  it("a recruiter of another company gets 403 on schedule, update, offer; sees none of these interviews or offers", async () => {
    const { rows: [iv] } = await db.query("SELECT interview_id::int AS id FROM interviews WHERE application_id = $1 LIMIT 1", [cand.main.applicationId]);
    const beforeState = await snapshot(cand.main.applicationId);
    const schedule = await api(`/api/recruiter/applications/${cand.main.applicationId}/interviews`, { method: "POST", cookie: kavya, json: videoInterview() });
    const update = await api(`/api/recruiter/interviews/${iv.id}`, { method: "PATCH", cookie: kavya, json: { action: "cancel" } });
    const offer = await api(`/api/recruiter/applications/${cand.expiry.applicationId}/offer`, { method: "POST", cookie: kavya, json: offerBody() });
    assert.deepEqual([schedule.status, update.status, offer.status], [403, 403, 403]);
    assert.deepEqual(await snapshot(cand.main.applicationId), beforeState);

    const ivs = await api("/api/recruiter/interviews", { cookie: kavya });
    const offers = await api("/api/recruiter/offers", { cookie: kavya });
    assert.equal(ivs.body.interviews.some((i) => i.jobId === job.id), false);
    assert.equal(offers.body.offers.some((o) => o.jobId === job.id), false);
    const mine = await api("/api/recruiter/interviews?scope=upcoming", { cookie: meera });
    assert.ok(mine.body.interviews.some((i) => i.jobId === job.id));
  });

  it("a candidate cannot schedule interviews, update them or make offers (403); no session is 401; unknown ids 404", async () => {
    const { cookie, applicationId } = cand.main;
    const { rows: [iv] } = await db.query("SELECT interview_id::int AS id FROM interviews WHERE application_id = $1 LIMIT 1", [applicationId]);
    const results = await Promise.all([
      api(`/api/recruiter/applications/${applicationId}/interviews`, { method: "POST", cookie, json: videoInterview() }),
      api(`/api/recruiter/interviews/${iv.id}`, { method: "PATCH", cookie, json: { action: "cancel" } }),
      api(`/api/recruiter/applications/${applicationId}/offer`, { method: "POST", cookie, json: offerBody() }),
      api("/api/recruiter/interviews", { cookie }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [403, 403, 403, 403]);
    const anon = await api(`/api/recruiter/applications/${applicationId}/offer`, { method: "POST", json: offerBody() });
    assert.equal(anon.status, 401);
    const missing = await api("/api/recruiter/applications/999999999/interviews", { method: "POST", cookie: meera, json: videoInterview() });
    assert.equal(missing.status, 404);
  });
});

describe("notifications inbox", () => {
  it("lists only the user's own notifications with the right unread count", async () => {
    const res = await api("/api/notifications", { cookie: cand.main.cookie });
    assert.equal(res.status, 200, res.text);
    const ids = res.body.notifications.map((n) => n.id);
    assert.ok(ids.length >= 6);
    const { rows } = await db.query("SELECT DISTINCT user_id::int FROM notifications WHERE notification_id = ANY($1::bigint[])", [ids]);
    assert.deepEqual(rows, [{ user_id: cand.main.id }]);
    const { rows: [u] } = await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read", [cand.main.id]);
    assert.equal(res.body.unreadCount, u.n);

    const other = await api("/api/notifications", { cookie: cand.applied.cookie });
    assert.equal(other.body.notifications.some((n) => ids.includes(n.id)), false);
    const bad = await api("/api/notifications?userId=1", { cookie: cand.main.cookie });
    assert.equal(bad.status, 400);
  });

  it("another user cannot mark someone's notification as read (404, unchanged); the owner can", async () => {
    const { rows: [n] } = await db.query(
      "SELECT notification_id::int AS id FROM notifications WHERE user_id = $1 AND NOT is_read ORDER BY notification_id LIMIT 1", [cand.main.id]);
    for (const cookie of [cand.applied.cookie, meera]) {
      const res = await api(`/api/notifications/${n.id}`, { method: "PATCH", cookie, json: { isRead: true } });
      assert.equal(res.status, 404, res.text);
    }
    assert.equal((await db.query("SELECT is_read FROM notifications WHERE notification_id = $1", [n.id])).rows[0].is_read, false);

    const before = (await api("/api/notifications", { cookie: cand.main.cookie })).body.unreadCount;
    const res = await api(`/api/notifications/${n.id}`, { method: "PATCH", cookie: cand.main.cookie, json: { isRead: true } });
    assert.equal(res.status, 200, res.text);
    assert.equal((await api("/api/notifications", { cookie: cand.main.cookie })).body.unreadCount, before - 1);
  });

  it("mark all as read only touches the user's own rows; unauthenticated is 401", async () => {
    const otherUnread = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read", [cand.rollback.id])).rows[0].n;
    assert.ok(otherUnread > 0);
    const res = await api("/api/notifications/read-all", { method: "POST", cookie: cand.main.cookie });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.body.updated > 0);
    const after = await api("/api/notifications?unreadOnly=true", { cookie: cand.main.cookie });
    assert.deepEqual([after.body.unreadCount, after.body.notifications.length], [0, 0]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read", [cand.rollback.id])).rows[0].n, otherUnread);
    assert.equal((await api("/api/notifications")).status, 401);
  });
});
