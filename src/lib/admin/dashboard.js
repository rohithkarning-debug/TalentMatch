import { query as defaultQuery } from "../db.js";

// Admin analytics. Every number on the dashboard comes from one of these
// queries. They reuse the Stage 2 views and generate_hiring_pipeline_report()
// instead of re-implementing their logic. Each query is also listed in
// db/queries/important_queries.sql (Stage 8 section).

export const PIPELINE_STAGES = ["applied", "shortlisted", "interviewed", "offered", "rejected"];

// 1. Platform totals: independent scalar subqueries in a single row.
export const TOTALS_SQL = `
SELECT (SELECT count(*) FROM candidates)::int                    AS candidates,
       (SELECT count(*) FROM recruiters)::int                    AS recruiters,
       (SELECT count(*) FROM recruiters r JOIN users u ON u.user_id = r.user_id
         WHERE u.is_active)::int                                 AS "activeRecruiters",
       (SELECT count(*) FROM companies)::int                     AS companies,
       (SELECT count(*) FROM jobs WHERE status = 'open')::int    AS "openJobs",
       (SELECT count(*) FROM applications)::int                  AS applications,
       (SELECT count(*) FROM interviews)::int                    AS interviews,
       (SELECT count(*) FROM offers)::int                        AS offers`;

// 2. Applications per pipeline stage (GROUP BY). The stage list is unnested
//    WITH ORDINALITY and LEFT JOINed so a stage with 0 applications still
//    shows up as 0, in funnel order.
export const STAGES_SQL = `
SELECT s.status, count(a.application_id)::int AS count
  FROM unnest($1::text[]) WITH ORDINALITY AS s(status, ord)
  LEFT JOIN applications a ON a.status = s.status
 GROUP BY s.status, s.ord
 ORDER BY s.ord`;

// 3. Top demanded skills across OPEN jobs (GROUP BY + HAVING): only skills
//    that at least two open jobs ask for.
export const TOP_SKILLS_SQL = `
SELECT s.skill_id::int AS id, s.name, s.category,
       count(*)::int                                 AS "jobCount",
       count(*) FILTER (WHERE js.is_required)::int   AS "requiredCount"
  FROM job_skills js
  JOIN jobs j   ON j.job_id = js.job_id
  JOIN skills s ON s.skill_id = js.skill_id
 WHERE j.status = 'open'
 GROUP BY s.skill_id, s.name, s.category
HAVING count(*) >= $1
 ORDER BY "jobCount" DESC, s.name
 LIMIT 10`;

// 4. Average match score by outcome, from candidate_application_view.
//    count(match_score) counts only scored applications (NULL = not embedded).
export const MATCH_BY_STATUS_SQL = `
SELECT v.application_status                    AS status,
       count(*)::int                           AS applications,
       count(v.match_score)::int               AS scored,
       round(avg(v.match_score), 4)::float8    AS "avgMatchScore"
  FROM candidate_application_view v
 GROUP BY v.application_status
 ORDER BY array_position($1::text[], v.application_status::text)`;

// 5. Per-company table. Application totals come from company_hiring_summary
//    (LEFT JOIN, because its HAVING drops companies with no applications).
//    Offer acceptance and interview rating are aggregated in their own
//    derived tables first, so no JOIN multiplies rows.
//    acceptance rate = accepted / (accepted + declined): pending and
//    withdrawn offers have no decision yet, so they are left out.
//    above_average uses a scalar subquery: the average number of
//    applications per company over ALL companies.
export const COMPANIES_SQL = `
SELECT c.company_id::int                                               AS id,
       c.name,
       c.industry,
       (SELECT count(*) FROM jobs j WHERE j.company_id = c.company_id)::int AS jobs,
       (SELECT count(*) FROM jobs j WHERE j.company_id = c.company_id
                                     AND j.status = 'open')::int       AS "openJobs",
       coalesce(s.total_applications, 0)::int                          AS applications,
       coalesce(o.offers_made, 0)::int                                 AS "offersMade",
       coalesce(o.accepted, 0)::int                                    AS "offersAccepted",
       coalesce(o.declined, 0)::int                                    AS "offersDeclined",
       round(100.0 * o.accepted / nullif(o.accepted + o.declined, 0), 1)::float8 AS "acceptanceRatePct",
       r.avg_rating::float8                                            AS "avgInterviewRating",
       coalesce(r.rated, 0)::int                                       AS "ratedInterviews",
       coalesce(s.total_applications, 0) > (
           SELECT avg(per_company.n)
             FROM (SELECT count(a.application_id) AS n
                     FROM companies c2
                     LEFT JOIN jobs j2        ON j2.company_id = c2.company_id
                     LEFT JOIN applications a ON a.job_id = j2.job_id
                    GROUP BY c2.company_id) per_company
       )                                                               AS "aboveAverage"
  FROM companies c
  LEFT JOIN company_hiring_summary s ON s.company_id = c.company_id
  LEFT JOIN (SELECT j.company_id,
                    count(*)                                    AS offers_made,
                    count(*) FILTER (WHERE o.status = 'accepted') AS accepted,
                    count(*) FILTER (WHERE o.status = 'declined') AS declined
               FROM offers o
               JOIN applications a ON a.application_id = o.application_id
               JOIN jobs j         ON j.job_id = a.job_id
              GROUP BY j.company_id) o ON o.company_id = c.company_id
  LEFT JOIN (SELECT j.company_id, round(avg(i.rating), 2) AS avg_rating, count(i.rating) AS rated
               FROM interviews i
               JOIN applications a ON a.application_id = i.application_id
               JOIN jobs j         ON j.job_id = a.job_id
              WHERE i.rating IS NOT NULL
              GROUP BY j.company_id) r ON r.company_id = c.company_id
 ORDER BY applications DESC, c.name`;

// The same average as a number for the dashboard caption.
export const AVG_APPLICATIONS_PER_COMPANY_SQL = `
SELECT round(avg(n), 2)::float8 AS avg
  FROM (SELECT count(a.application_id) AS n
          FROM companies c
          LEFT JOIN jobs j         ON j.company_id = c.company_id
          LEFT JOIN applications a ON a.job_id = j.job_id
         GROUP BY c.company_id) per_company`;

// 6. Applications per job: the stored function from migration 012.
export const JOBS_SQL = `
SELECT r.job_id::int AS id, r.company_name AS company, r.job_title AS title, r.job_status AS status,
       r.total_applications::int AS applications,
       r.applied::int, r.shortlisted::int, r.interviewed::int, r.offered::int, r.rejected::int,
       r.shortlist_rate_pct::float8 AS "shortlistRatePct",
       r.offer_rate_pct::float8     AS "offerRatePct",
       r.avg_match_score::float8    AS "avgMatchScore"
  FROM generate_hiring_pipeline_report() r
 ORDER BY r.total_applications DESC, r.company_name, r.job_title`;

export const MIN_JOBS_PER_SKILL = 2;

export async function loadDashboard({ query = defaultQuery } = {}) {
  const [totals, stages, skills, match, companies, avg, jobs] = await Promise.all([
    query(TOTALS_SQL),
    query(STAGES_SQL, [PIPELINE_STAGES]),
    query(TOP_SKILLS_SQL, [MIN_JOBS_PER_SKILL]),
    query(MATCH_BY_STATUS_SQL, [PIPELINE_STAGES]),
    query(COMPANIES_SQL),
    query(AVG_APPLICATIONS_PER_COMPANY_SQL),
    query(JOBS_SQL),
  ]);
  return {
    totals: totals.rows[0],
    applicationsByStage: stages.rows,
    topSkills: skills.rows,
    minJobsPerSkill: MIN_JOBS_PER_SKILL,
    matchScoreByStatus: match.rows,
    companies: companies.rows,
    avgApplicationsPerCompany: avg.rows[0].avg,
    jobs: jobs.rows,
  };
}
