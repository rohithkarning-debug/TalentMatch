import { notFound, forbidden } from "./api/api-error.js";
import { rethrowBusinessRule } from "./api/db-rules.js";
import { getPool } from "./db.js";
import { formatDateTime } from "./format-date.js";
import { assertApplicationInRecruiterCompany } from "./recruiter/jobs.js";

// Interview actions of a recruiter. Each one is a single transaction.
// The rules (future time, valid state changes, rating 1-5, location for
// video/onsite) live in the database: trg_interviews_guard and the CHECK
// constraints. Their errors become 409 / 400 responses.

// Notification texts show Indian time, whatever the server's time zone is,
// in the same format as the UI: "23 Oct 2026, 11:00 am IST".
export const formatIndianDateTime = (value) => `${formatDateTime(value)} IST`;

const INTERVIEW_COLUMNS = `
  i.interview_id::int AS id, i.application_id::int AS "applicationId", i.round_no AS "roundNo",
  i.scheduled_at AS "scheduledAt", i.duration_minutes AS "durationMinutes", i.mode,
  i.location_or_link AS "locationOrLink", i.status, i.rating, i.feedback, i.updated_at AS "updatedAt"`;

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    rethrowBusinessRule(err);
  } finally {
    client.release();
  }
}

// Schedule the next interview round as ONE transaction:
//
//   BEGIN
//     1. lock the application (FOR UPDATE) and check it is the recruiter's company
//     2. round_no = highest round so far + 1 (safe: the row lock serialises this)
//     3. INSERT the interview        -> trg_interviews_guard: future time,
//                                       application shortlisted/interviewed
//     4. first interview only: update_application_status(..., 'interviewed')
//                                    -> trg_applications_status_guard (shortlisted -> interviewed)
//                                    -> trg_applications_status_history (audit row)
//                                    -> the function's 'status_changed' notification
//     5. INSERT the 'interview_scheduled' notification for the candidate
//   COMMIT  -> trg_applications_stage_records (deferred) sees the interview exists
export async function scheduleInterview(user, applicationId, data, { pool = getPool() } = {}) {
  return inTransaction(pool, async (client) => {
    const app = await assertApplicationInRecruiterCompany(applicationId, user, { query: (t, p) => client.query(t, p), lock: true });

    const next = await client.query(
      "SELECT coalesce(max(round_no), 0) + 1 AS round FROM interviews WHERE application_id = $1", [app.id]);
    const roundNo = next.rows[0].round;

    const inserted = await client.query(
      `INSERT INTO interviews AS i (application_id, round_no, scheduled_at, duration_minutes, mode, location_or_link, interviewer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${INTERVIEW_COLUMNS}`,
      [app.id, roundNo, data.scheduledAt, data.durationMinutes, data.mode, data.locationOrLink, user.id]);
    const interview = inserted.rows[0];

    let applicationStatus = app.status;
    if (app.status !== "interviewed") {
      const moved = await client.query(
        "SELECT status FROM update_application_status($1, 'interviewed', $2, $3)",
        [app.id, user.id, `Interview round ${roundNo} scheduled`]);
      applicationStatus = moved.rows[0].status;
    }

    const where = interview.locationOrLink ? ` (${interview.locationOrLink})` : "";
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, related_application_id)
       VALUES ($1, 'interview_scheduled', $2, $3, $4)`,
      [app.candidateId, `Interview round ${roundNo} scheduled: ${app.jobTitle}`.slice(0, 150),
        `${app.company} scheduled a ${interview.mode} interview for ${app.jobTitle} on ${formatIndianDateTime(interview.scheduledAt)}${where}.`,
        app.id]);

    return { interview, applicationStatus };
  });
}

// Lock one interview and check the recruiter's company owns it.
async function lockInterviewForRecruiter(client, interviewId, user) {
  const { rows } = await client.query(
    `SELECT i.interview_id, i.status, i.round_no, a.application_id::int AS "applicationId",
            a.candidate_id::int AS "candidateId", j.title AS "jobTitle", j.company_id, c.name AS company,
            (SELECT r.company_id FROM recruiters r WHERE r.user_id = $2) AS recruiter_company_id
       FROM interviews i
       JOIN applications a ON a.application_id = i.application_id
       JOIN jobs j         ON j.job_id = a.job_id
       JOIN companies c    ON c.company_id = j.company_id
      WHERE i.interview_id = $1
        FOR UPDATE OF i`, [interviewId, user.id]);
  if (!rows.length) throw notFound("Interview not found");
  const iv = rows[0];
  if (iv.recruiter_company_id === null || String(iv.recruiter_company_id) !== String(iv.company_id)) {
    throw forbidden("You can only manage interviews for your own company's jobs");
  }
  return iv;
}

// Reschedule, cancel or complete. The candidate is told about a new time or
// a cancellation; rating and feedback are internal and never sent to them.
export async function updateInterview(user, interviewId, data, { pool = getPool() } = {}) {
  return inTransaction(pool, async (client) => {
    const iv = await lockInterviewForRecruiter(client, interviewId, user);
    let result, note = null;

    if (data.action === "reschedule") {
      result = await client.query(
        `UPDATE interviews AS i SET scheduled_at = $2, location_or_link = coalesce($3, location_or_link)
          WHERE interview_id = $1 RETURNING ${INTERVIEW_COLUMNS}`,
        [interviewId, data.scheduledAt, data.locationOrLink ?? null]);
      note = {
        title: `Interview round ${iv.round_no} rescheduled: ${iv.jobTitle}`,
        message: `Your interview for ${iv.jobTitle} at ${iv.company} moved to ${formatIndianDateTime(data.scheduledAt)}.`,
      };
    } else if (data.action === "cancel") {
      result = await client.query(
        `UPDATE interviews AS i SET status = 'cancelled' WHERE interview_id = $1 RETURNING ${INTERVIEW_COLUMNS}`, [interviewId]);
      note = {
        title: `Interview round ${iv.round_no} cancelled: ${iv.jobTitle}`,
        message: `Your interview for ${iv.jobTitle} at ${iv.company} was cancelled.${data.reason ? ` Reason: ${data.reason}` : ""}`,
      };
    } else {
      result = await client.query(
        `UPDATE interviews AS i SET status = 'completed', rating = $2, feedback = $3
          WHERE interview_id = $1 RETURNING ${INTERVIEW_COLUMNS}`, [interviewId, data.rating, data.feedback]);
    }

    if (note) {
      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, related_application_id)
         VALUES ($1, 'interview_updated', $2, $3, $4)`,
        [iv.candidateId, note.title.slice(0, 150), note.message, iv.applicationId]);
    }
    return result.rows[0];
  });
}
