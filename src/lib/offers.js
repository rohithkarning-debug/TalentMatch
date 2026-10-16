import { ApiError, forbidden, notFound } from "./api/api-error.js";
import { toBusinessRuleError } from "./api/db-rules.js";
import { getPool } from "./db.js";
import { assertApplicationInRecruiterCompany } from "./recruiter/jobs.js";

// Offer actions: make (recruiter), accept / decline (candidate), withdraw
// (recruiter). Each is ONE explicit transaction: every step succeeds or the
// ROLLBACK undoes all of them, including the work done by triggers and by
// update_application_status() inside the transaction.

const OFFER_COLUMNS = `
  o.offer_id::int AS id, o.application_id::int AS "applicationId", o.salary_offered::float8 AS "salaryOffered",
  o.currency, o.joining_date::text AS "joiningDate", o.expires_on::text AS "expiresOn", o.status,
  o.offered_at AS "offeredAt", o.responded_at AS "respondedAt"`;

const formatMoney = (amount, currency) =>
  `${currency === "INR" ? "₹" : `${currency} `}${Number(amount).toLocaleString("en-IN")}`;

// The "offer made" notification text. Injectable only so the rollback test
// can make the LAST step fail on purpose.
export function defaultOfferNotification({ jobTitle, company, salary, joiningDate, expiresOn }) {
  return {
    title: `Offer received: ${jobTitle}`.slice(0, 150),
    message: `${company} has offered you the ${jobTitle} role at ${salary} per year, joining on ${joiningDate}. Please respond by ${expiresOn}.`,
  };
}

function translate(err) {
  if (err?.code === "23505" && err?.constraint === "offers_application_id_key") {
    return new ApiError(409, "OFFER_EXISTS", "This application already has an offer");
  }
  return toBusinessRuleError(err) || err;
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");   // deferred trigger trg_applications_stage_records runs here
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw translate(err);
  } finally {
    client.release();
  }
}

// Make an offer:
//
//   BEGIN
//     1. lock the application and check it is the recruiter's company
//     2. update_application_status(app, 'offered')
//          -> trg_applications_status_guard: ONLY interviewed -> offered is allowed
//             (an 'applied' application fails right here)
//          -> trg_applications_status_history writes the audit row
//          -> the function notifies the candidate ('status_changed')
//     3. INSERT the offer   -> UNIQUE (application_id): one offer per application
//                           -> trg_offers_guard: joining after today, expiry not past
//     4. INSERT the 'offer_made' notification
//   COMMIT -> deferred trg_applications_stage_records: 'offered' has a pending offer
//
// If step 3 or 4 fails, the ROLLBACK also removes step 2's status change,
// history row and notification. The application is exactly as before.
// Status goes first on purpose: the transition rule is checked before any
// offer row exists, and the deferred trigger only checks the end result.
export async function makeOffer(user, applicationId, data, { pool = getPool(), notification = defaultOfferNotification } = {}) {
  return inTransaction(pool, async (client) => {
    const app = await assertApplicationInRecruiterCompany(applicationId, user, { query: (t, p) => client.query(t, p), lock: true });

    await client.query("SELECT update_application_status($1, 'offered', $2, $3)", [app.id, user.id, "Offer made"]);

    const inserted = await client.query(
      `INSERT INTO offers AS o (application_id, salary_offered, currency, joining_date, expires_on)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${OFFER_COLUMNS}`,
      [app.id, data.salaryOffered, data.currency, data.joiningDate, data.expiresOn]);
    const offer = inserted.rows[0];

    const note = notification({ jobTitle: app.jobTitle, company: app.company,
      salary: formatMoney(offer.salaryOffered, offer.currency), joiningDate: offer.joiningDate, expiresOn: offer.expiresOn });
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, related_application_id)
       VALUES ($1, 'offer_made', $2, $3, $4)`,
      [app.candidateId, note.title, note.message, app.id]);

    return offer;
  });
}

// Accept or decline (candidate). The WHERE clause includes the candidate,
// so someone else's offer is "not found" (404): we do not even reveal that
// it exists. Expiry and "only pending" are enforced by trg_offers_guard.
export async function respondToOffer(candidateId, offerId, decision, { pool = getPool() } = {}) {
  const status = decision === "accept" ? "accepted" : "declined";
  return inTransaction(pool, async (client) => {
    const found = await client.query(
      `SELECT o.offer_id, a.application_id::int AS "applicationId", j.title AS "jobTitle",
              j.company_id, j.recruiter_id, u.full_name AS "candidateName"
         FROM offers o
         JOIN applications a ON a.application_id = o.application_id
         JOIN jobs j         ON j.job_id = a.job_id
         JOIN users u        ON u.user_id = a.candidate_id
        WHERE o.offer_id = $1 AND a.candidate_id = $2
          FOR UPDATE OF o`, [offerId, candidateId]);
    if (!found.rowCount) throw notFound("Offer not found");
    const row = found.rows[0];

    const updated = await client.query(
      `UPDATE offers AS o SET status = $2, responded_at = now()
        WHERE offer_id = $1 RETURNING ${OFFER_COLUMNS}`, [offerId, status]);

    // The recruiter who posted the job; if that recruiter was removed
    // (recruiter_id NULL), every recruiter of the company instead.
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, related_application_id)
       SELECT r.user_id, 'offer_responded', $3, $4, $5
         FROM recruiters r
        WHERE r.company_id = $1 AND ($2::bigint IS NULL OR r.user_id = $2)`,
      [row.company_id, row.recruiter_id, `Offer ${status}: ${row.jobTitle}`.slice(0, 150),
        `${row.candidateName} ${status} your offer for ${row.jobTitle}.`, row.applicationId]);

    return updated.rows[0];
  });
}

// Withdraw a pending offer (recruiter): offer -> 'withdrawn' and the
// application offered -> rejected (allowed by the transition rule), so the
// pipeline no longer shows the candidate as "offered".
export async function withdrawOffer(user, offerId, { pool = getPool() } = {}) {
  return inTransaction(pool, async (client) => {
    const found = await client.query(
      `SELECT o.offer_id, a.application_id::int AS "applicationId", a.candidate_id::int AS "candidateId",
              j.title AS "jobTitle", j.company_id, c.name AS company,
              (SELECT r.company_id FROM recruiters r WHERE r.user_id = $2) AS recruiter_company_id
         FROM offers o
         JOIN applications a ON a.application_id = o.application_id
         JOIN jobs j         ON j.job_id = a.job_id
         JOIN companies c    ON c.company_id = j.company_id
        WHERE o.offer_id = $1
          FOR UPDATE OF o`, [offerId, user.id]);
    if (!found.rowCount) throw notFound("Offer not found");
    const row = found.rows[0];
    if (row.recruiter_company_id === null || String(row.recruiter_company_id) !== String(row.company_id)) {
      throw forbidden("You can only manage offers for your own company's jobs");
    }

    const updated = await client.query(
      `UPDATE offers AS o SET status = 'withdrawn' WHERE offer_id = $1 RETURNING ${OFFER_COLUMNS}`, [offerId]);
    await client.query("SELECT update_application_status($1, 'rejected', $2, $3)",
      [row.applicationId, user.id, "Offer withdrawn"]);
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, related_application_id)
       VALUES ($1, 'offer_withdrawn', $2, $3, $4)`,
      [row.candidateId, `Offer withdrawn: ${row.jobTitle}`.slice(0, 150),
        `${row.company} has withdrawn its offer for ${row.jobTitle}.`, row.applicationId]);
    return updated.rows[0];
  });
}
