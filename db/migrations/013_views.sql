-- 013: Views
-- A view is a saved SELECT: the app queries it like a table, the database
-- runs the underlying query every time, so the data is always current.
--
-- Avoiding double counting: a job has many applications AND many interviews.
-- Joining both in one FROM clause would produce applications × interviews
-- rows and inflate every count. So each view joins only along one "many" side
-- and fetches the others with subqueries.

-- ---------------------------------------------------------------------------
-- recruiter_pipeline_view — one row per job, with its recruiter and funnel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW recruiter_pipeline_view AS
SELECT
    r.user_id                                               AS recruiter_id,
    u.full_name                                             AS recruiter_name,
    c.company_id,
    c.name                                                  AS company_name,
    j.job_id,
    j.title                                                 AS job_title,
    j.status                                                AS job_status,
    j.posted_at,
    j.closes_at,
    j.openings,
    count(a.application_id)                                 AS total_applications,
    count(*) FILTER (WHERE a.status = 'applied')            AS applied,
    count(*) FILTER (WHERE a.status = 'shortlisted')        AS shortlisted,
    count(*) FILTER (WHERE a.status = 'interviewed')        AS interviewed,
    count(*) FILTER (WHERE a.status = 'offered')            AS offered,
    count(*) FILTER (WHERE a.status = 'rejected')           AS rejected,
    count(*) FILTER (WHERE a.status IN ('applied', 'shortlisted', 'interviewed'))
                                                            AS active_in_pipeline,
    round(avg(a.match_score), 4)                            AS avg_match_score,
    max(a.applied_at)                                       AS last_application_at,
    (SELECT count(*)
       FROM interviews i
       JOIN applications a2 ON a2.application_id = i.application_id
      WHERE a2.job_id = j.job_id
        AND i.status = 'scheduled'
        AND i.scheduled_at >= now())                        AS upcoming_interviews
FROM jobs j
JOIN companies c        ON c.company_id = j.company_id
LEFT JOIN recruiters r  ON r.user_id = j.recruiter_id
LEFT JOIN users u       ON u.user_id = r.user_id
LEFT JOIN applications a ON a.job_id = j.job_id
GROUP BY r.user_id, u.full_name, c.company_id, c.name, j.job_id;

COMMENT ON VIEW recruiter_pipeline_view IS
    'One row per job: recruiter, company, application counts per stage, active pipeline, avg match score, upcoming interviews.';

-- ---------------------------------------------------------------------------
-- candidate_application_view — one row per application, everything a
-- candidate needs on their "My applications" page
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW candidate_application_view AS
SELECT
    a.application_id,
    a.candidate_id,
    cu.full_name                    AS candidate_name,
    cu.email                        AS candidate_email,
    j.job_id,
    j.title                         AS job_title,
    j.status                        AS job_status,
    j.location                      AS job_location,
    j.work_mode,
    j.employment_type,
    j.salary_min,
    j.salary_max,
    j.currency,
    c.company_id,
    c.name                          AS company_name,
    c.industry                      AS company_industry,
    a.status                        AS application_status,
    a.match_score,
    a.applied_at,
    a.updated_at,
    last_change.changed_at          AS status_changed_at,
    next_iv.scheduled_at            AS next_interview_at,
    next_iv.mode                    AS next_interview_mode,
    o.status                        AS offer_status,
    o.salary_offered                AS offer_salary,
    o.joining_date                  AS offer_joining_date
FROM applications a
JOIN users cu     ON cu.user_id   = a.candidate_id
JOIN jobs j       ON j.job_id     = a.job_id
JOIN companies c  ON c.company_id = j.company_id
LEFT JOIN offers o ON o.application_id = a.application_id   -- at most 1 (UNIQUE)
-- LATERAL = "for each application, run this small query": latest status change
LEFT JOIN LATERAL (
    SELECT h.changed_at
      FROM application_status_history h
     WHERE h.application_id = a.application_id
     ORDER BY h.changed_at DESC, h.history_id DESC
     LIMIT 1
) last_change ON TRUE
-- ...and the next scheduled interview, if any
LEFT JOIN LATERAL (
    SELECT i.scheduled_at, i.mode
      FROM interviews i
     WHERE i.application_id = a.application_id
       AND i.status = 'scheduled'
       AND i.scheduled_at >= now()
     ORDER BY i.scheduled_at
     LIMIT 1
) next_iv ON TRUE;

COMMENT ON VIEW candidate_application_view IS
    'One row per application with job, company, current status, last status change, next interview and offer details.';

-- ---------------------------------------------------------------------------
-- company_hiring_summary — one row per company with hiring activity
-- ---------------------------------------------------------------------------
-- Joins jobs -> applications -> offers. Each application belongs to exactly
-- one job and has at most one offer, so application rows are not duplicated;
-- jobs ARE repeated once per application, hence count(DISTINCT j.job_id).
-- HAVING keeps only companies that have received at least one application,
-- so the summary is about actual hiring activity, not empty postings.
CREATE OR REPLACE VIEW company_hiring_summary AS
SELECT
    c.company_id,
    c.name                                                       AS company_name,
    c.industry,
    count(DISTINCT j.job_id)                                     AS total_jobs,
    count(DISTINCT j.job_id) FILTER (WHERE j.status = 'open')    AS open_jobs,
    count(a.application_id)                                      AS total_applications,
    count(DISTINCT a.candidate_id)                               AS unique_candidates,
    round(count(a.application_id)::numeric
          / nullif(count(DISTINCT j.job_id), 0), 2)              AS avg_applications_per_job,
    count(a.application_id) FILTER (WHERE a.status = 'offered')  AS currently_offered,
    count(a.application_id) FILTER (WHERE a.status = 'rejected') AS rejected,
    round(100.0 * count(a.application_id) FILTER (WHERE a.status = 'rejected')
          / nullif(count(a.application_id), 0), 1)               AS rejection_rate_pct,
    count(o.offer_id)                                            AS offers_made,
    count(o.offer_id) FILTER (WHERE o.status = 'accepted')       AS offers_accepted,
    round(avg(a.match_score), 4)                                 AS avg_match_score
FROM companies c
JOIN jobs j               ON j.company_id = c.company_id
LEFT JOIN applications a  ON a.job_id = j.job_id
LEFT JOIN offers o        ON o.application_id = a.application_id
GROUP BY c.company_id, c.name, c.industry
HAVING count(a.application_id) > 0;

COMMENT ON VIEW company_hiring_summary IS
    'Per-company hiring statistics; HAVING excludes companies with no applications.';
