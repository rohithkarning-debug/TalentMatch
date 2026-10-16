import { forbidden, notFound } from "../api/errors.js";
import { query as defaultQuery } from "../db.js";

// Shared SQL for the recruiter job routes. Ownership rule: a recruiter may
// manage every job of THEIR company (not only jobs they posted themselves),
// the same rule update_application_status() applies in the database.

// camelCase API field -> jobs column. Only these fixed column names are ever
// placed in dynamic UPDATE SQL; every value goes in as a $n parameter.
export const JOB_COLUMNS = {
  title: "title",
  description: "description",
  location: "location",
  workMode: "work_mode",
  employmentType: "employment_type",
  salaryMin: "salary_min",
  salaryMax: "salary_max",
  currency: "currency",
  openings: "openings",
  minExperienceYears: "min_experience_years",
  closesAt: "closes_at",
  status: "status",
};

// Load the job and the recruiter's company from the DATABASE and compare
// them. 404 if the job does not exist, 403 if it belongs to another company.
// Pass { lock: true } inside a transaction to lock the job row (FOR UPDATE)
// so a concurrent edit or delete waits for this one.
export async function assertJobInRecruiterCompany(jobId, user, { query = defaultQuery, lock = false } = {}) {
  const { rows } = await query(
    `SELECT j.job_id, j.company_id, j.status,
            (SELECT r.company_id FROM recruiters r WHERE r.user_id = $2) AS recruiter_company_id
       FROM jobs j
      WHERE j.job_id = $1
      ${lock ? "FOR UPDATE OF j" : ""}`, [jobId, user.id]);
  if (!rows.length) throw notFound("Job not found");
  const job = rows[0];
  if (job.recruiter_company_id === null || String(job.recruiter_company_id) !== String(job.company_id)) {
    throw forbidden("You can only manage jobs of your own company");
  }
  return job;
}

// Replace the job's skill list: delete the old rows, insert the new ones.
// Runs inside the caller's transaction. An unknown skill id fails the
// job_skills_skill_fkey FOREIGN KEY and rolls everything back.
export async function replaceJobSkills(client, jobId, skills) {
  await client.query("DELETE FROM job_skills WHERE job_id = $1", [jobId]);
  if (!skills.length) return;
  // unnest() turns three parallel arrays into rows: one INSERT, any count.
  await client.query(
    `INSERT INTO job_skills (job_id, skill_id, is_required, min_proficiency)
     SELECT $1, s.skill_id, s.is_required, s.min_proficiency
       FROM unnest($2::bigint[], $3::boolean[], $4::smallint[]) AS s(skill_id, is_required, min_proficiency)`,
    [jobId, skills.map((s) => s.skillId), skills.map((s) => s.isRequired), skills.map((s) => s.minProficiency)]);
}

// One job with its skills, embedding state and posting recruiter.
export async function loadJobDetail(jobId, query = defaultQuery) {
  const { rows } = await query(
    `SELECT j.job_id::int AS id, j.company_id::int AS "companyId", c.name AS company,
            j.recruiter_id::int AS "recruiterId", u.full_name AS "postedBy",
            j.title, j.description, j.location, j.work_mode AS "workMode",
            j.employment_type AS "employmentType",
            j.salary_min::float8 AS "salaryMin", j.salary_max::float8 AS "salaryMax", j.currency,
            j.openings, j.min_experience_years::float8 AS "minExperienceYears",
            to_char(j.closes_at, 'YYYY-MM-DD') AS "closesAt", j.status,
            j.applicant_count AS "applicantCount", j.posted_at AS "postedAt", j.updated_at AS "updatedAt",
            je.model_name IS NOT NULL AS "isEmbedded", je.created_at AS "embeddedAt",
            COALESCE((SELECT json_agg(json_build_object(
                         'skillId', s.skill_id, 'name', s.name, 'category', s.category,
                         'isRequired', js.is_required, 'minProficiency', js.min_proficiency)
                       ORDER BY js.is_required DESC, s.name)
                        FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
                       WHERE js.job_id = j.job_id), '[]') AS skills
       FROM jobs j
       JOIN companies c ON c.company_id = j.company_id
       LEFT JOIN users u ON u.user_id = j.recruiter_id
       LEFT JOIN job_embeddings je ON je.job_id = j.job_id
      WHERE j.job_id = $1`, [jobId]);
  return rows[0] || null;
}
