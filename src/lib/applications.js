import { ApiError, notFound } from "./api/api-error.js";
import { getPool } from "./db.js";

// The text of the "new application" notification sent to the recruiter.
// Injectable only so the rollback test can make this step fail on purpose.
export function defaultApplicationNotification({ jobTitle, candidateName }) {
  return {
    title: `New application: ${jobTitle}`.slice(0, 150),
    message: `${candidateName} applied for ${jobTitle}.`,
  };
}

// Apply to a job as ONE explicit transaction:
//
//   BEGIN
//     1. lock the job row (FOR SHARE) and check it is open
//     2. check the chosen resume belongs to the candidate
//     3. INSERT the application; match_score = compute_match_score(resume, job)
//        - triggers fire inside this same transaction:
//          trg_applications_initial_status  (must start as 'applied')
//          trg_applications_applicant_count (jobs.applicant_count + 1)
//          trg_applications_status_history  (NULL -> applied history row)
//     4. INSERT the notification for the job's recruiter
//   COMMIT            -- all four become visible together
//   ROLLBACK on any error -- none of them happened, including the trigger work
//
// FOR SHARE: other transactions can still read the job and other candidates
// can apply at the same time (share locks do not conflict with each other),
// but a recruiter closing or deleting the job (UPDATE/DELETE need a stronger
// lock) has to wait until we commit, so nobody can apply to a job that is
// being closed at that same moment.
//
// Duplicates are NOT pre-checked with a SELECT (two requests could both pass
// it). The UNIQUE (job_id, candidate_id) constraint rejects the second
// INSERT atomically and we turn that into 409.
export async function applyToJob(
  { candidateId, jobId, resumeId, coverLetter = null },
  { pool = getPool(), notification = defaultApplicationNotification } = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const job = await client.query(
      "SELECT job_id, title, status, company_id, recruiter_id FROM jobs WHERE job_id = $1 FOR SHARE", [jobId]);
    // Draft jobs are not published, so to a candidate they do not exist.
    if (!job.rowCount || job.rows[0].status === "draft") throw notFound("Job not found");
    if (job.rows[0].status !== "open") {
      throw new ApiError(409, "JOB_NOT_OPEN", "This job is closed and no longer accepts applications");
    }
    const { title: jobTitle, company_id: companyId, recruiter_id: recruiterId } = job.rows[0];

    const resume = await client.query(
      "SELECT resume_id FROM resumes WHERE resume_id = $1 AND candidate_id = $2 FOR SHARE", [resumeId, candidateId]);
    if (!resume.rowCount) throw notFound("Resume not found");

    // Real cosine similarity computed in the database; NULL if the resume or
    // the job has no embedding yet. applicant_count is NOT touched here: the
    // AFTER INSERT trigger maintains it.
    const inserted = await client.query(
      `INSERT INTO applications (job_id, candidate_id, resume_id, cover_letter, match_score)
       VALUES ($1, $2, $3, $4, compute_match_score($3, $1))
       RETURNING application_id::int AS id, job_id::int AS "jobId", resume_id::int AS "resumeId",
                 status, match_score::float8 AS "matchScore", applied_at AS "appliedAt"`,
      [jobId, candidateId, resumeId, coverLetter]);
    const application = inserted.rows[0];

    const candidate = await client.query("SELECT full_name FROM users WHERE user_id = $1", [candidateId]);
    const note = notification({ jobTitle, candidateName: candidate.rows[0].full_name });
    // The recruiter who posted the job; if that recruiter was removed
    // (recruiter_id NULL), every recruiter of the company instead.
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, related_application_id)
       SELECT r.user_id, 'application_submitted', $3, $4, $5
         FROM recruiters r
        WHERE r.company_id = $1 AND ($2::bigint IS NULL OR r.user_id = $2)`,
      [companyId, recruiterId, note.title, note.message, application.id]);

    await client.query("COMMIT");
    return application;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505" && err?.constraint === "applications_job_id_candidate_id_key") {
      throw new ApiError(409, "ALREADY_APPLIED", "You have already applied to this job");
    }
    throw err;
  } finally {
    client.release();
  }
}
