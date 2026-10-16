-- ============================================================================
-- TalentMatch — Important SQL queries
-- Queries against the seeded schema; they leave the data unchanged (Q23
-- writes inside a transaction that it rolls back). Each one is preceded by:
--   DEMONSTRATES: the SQL concept(s)   RETURNS: what you get back
--   WHY: how TalentMatch uses it
--
-- Run all (PowerShell, from the project root):
--   Get-Content db/queries/important_queries.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off

\echo '\n=== Q1  Open jobs with company and recruiter ==='
-- DEMONSTRATES: INNER JOIN, LEFT JOIN, WHERE, ORDER BY (served by the partial
--               index jobs_open_posted_at_idx).
-- RETURNS: every open job, newest first, with its company and recruiter.
-- WHY: the candidate "Browse jobs" page.
SELECT j.job_id, j.title, c.name AS company, u.full_name AS recruiter,
       j.location, j.work_mode, j.posted_at::date AS posted
FROM jobs j
JOIN companies c       ON c.company_id = j.company_id
LEFT JOIN users u      ON u.user_id = j.recruiter_id   -- recruiter may be NULL
WHERE j.status = 'open'
ORDER BY j.posted_at DESC;

\echo '\n=== Q2  Applications per status (aggregate + GROUP BY) ==='
-- DEMONSTRATES: GROUP BY, COUNT, ROUND, window function over an aggregate.
-- RETURNS: how many applications are in each stage and the share of the total.
-- WHY: the top of the admin dashboard's hiring funnel.
SELECT status,
       count(*)                                              AS applications,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1)    AS pct_of_total
FROM applications
GROUP BY status
ORDER BY array_position(ARRAY['applied','shortlisted','interviewed','offered','rejected'], status::text);

\echo '\n=== Q3  Jobs with at least 3 applicants (GROUP BY + HAVING) ==='
-- DEMONSTRATES: JOIN, GROUP BY, HAVING (filter on an aggregate), ORDER BY.
-- RETURNS: popular jobs and their applicant numbers.
-- WHY: recruiters prioritise screening for the most popular postings.
SELECT c.name AS company, j.title, count(a.application_id) AS applicants
FROM jobs j
JOIN companies c     ON c.company_id = j.company_id
JOIN applications a  ON a.job_id = j.job_id
GROUP BY c.name, j.job_id, j.title
HAVING count(a.application_id) >= 3
ORDER BY applicants DESC, j.title;

\echo '\n=== Q4  Salary statistics per company (aggregate functions) ==='
-- DEMONSTRATES: MIN, MAX, AVG, COUNT with FILTER, GROUP BY.
-- RETURNS: salary range and average midpoint of each company's postings (INR/yr).
-- WHY: admin analytics; candidates comparing companies.
SELECT c.name AS company,
       count(*)                                   AS jobs,
       count(*) FILTER (WHERE j.status = 'open')  AS open_jobs,
       min(j.salary_min)                          AS lowest_min,
       max(j.salary_max)                          AS highest_max,
       round(avg((j.salary_min + j.salary_max) / 2))  AS avg_midpoint
FROM jobs j
JOIN companies c ON c.company_id = j.company_id
GROUP BY c.name
ORDER BY avg_midpoint DESC;

\echo '\n=== Q5  Candidates who have NOT applied anywhere (NOT EXISTS) ==='
-- DEMONSTRATES: NOT EXISTS anti-join.
-- RETURNS: registered candidates with zero applications.
-- WHY: re-engagement: suggest matching jobs to inactive candidates.
-- (With the current seed every candidate has applied, so this returns 0 rows,
--  which is itself the correct answer.)
SELECT u.user_id, u.full_name, cd.headline
FROM candidates cd
JOIN users u ON u.user_id = cd.user_id
WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = cd.user_id);

\echo '\n=== Q6  Open jobs that nobody has applied to yet (NOT EXISTS) ==='
-- DEMONSTRATES: NOT EXISTS on another table.
-- RETURNS: open/draft postings with no applications.
-- WHY: recruiters see which postings need better descriptions or promotion.
SELECT j.job_id, j.title, j.status
FROM jobs j
WHERE j.status IN ('open', 'draft')
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.job_id);

\echo '\n=== Q7  Candidates with at least one REQUIRED skill of the ML Engineer job (IN + subquery) ==='
-- DEMONSTRATES: IN (subquery), nested subquery, DISTINCT.
-- RETURNS: candidates who list any skill the job marks as required.
-- WHY: a simple keyword-style shortlist, compared later with semantic ranking.
SELECT DISTINCT u.full_name, cd.headline
FROM candidate_skills cs
JOIN candidates cd ON cd.user_id = cs.candidate_id
JOIN users u       ON u.user_id = cs.candidate_id
WHERE cs.skill_id IN (
        SELECT js.skill_id FROM job_skills js
        WHERE js.is_required
          AND js.job_id = (SELECT job_id FROM jobs WHERE title = 'Machine Learning Engineer'))
ORDER BY u.full_name;

\echo '\n=== Q8  Required-skill coverage per applicant (correlated subqueries) ==='
-- DEMONSTRATES: correlated subqueries (the inner query uses a.job_id and
--               a.candidate_id from the outer row), JOIN.
-- RETURNS: for each application, how many of the job's required skills the
--          candidate has, at or above the required proficiency.
-- WHY: explainable "skills matched 3/3" badge next to the semantic match score.
SELECT j.title, u.full_name, a.status,
       (SELECT count(*)
          FROM job_skills js
          JOIN candidate_skills cs ON cs.skill_id = js.skill_id
                                  AND cs.candidate_id = a.candidate_id
                                  AND cs.proficiency >= js.min_proficiency
         WHERE js.job_id = a.job_id AND js.is_required)               AS required_met,
       (SELECT count(*) FROM job_skills js
         WHERE js.job_id = a.job_id AND js.is_required)               AS required_total
FROM applications a
JOIN jobs j  ON j.job_id = a.job_id
JOIN users u ON u.user_id = a.candidate_id
ORDER BY j.title, required_met DESC, u.full_name;

\echo '\n=== Q9  Candidates with above-average experience (scalar subquery) ==='
-- DEMONSTRATES: scalar subquery in WHERE and SELECT, AVG.
-- RETURNS: candidates whose experience exceeds the platform average.
-- WHY: helps recruiters find senior profiles quickly.
SELECT u.full_name, cd.years_experience,
       (SELECT round(avg(years_experience), 2) FROM candidates) AS platform_avg
FROM candidates cd
JOIN users u ON u.user_id = cd.user_id
WHERE cd.years_experience > (SELECT avg(years_experience) FROM candidates)
ORDER BY cd.years_experience DESC;

\echo '\n=== Q10 Most in-demand skills across jobs vs. supply among candidates ==='
-- DEMONSTRATES: LEFT JOIN + GROUP BY with COUNT(DISTINCT) on two M:N tables,
--               HAVING.
-- RETURNS: skills required by 2+ jobs, with how many candidates have them.
-- WHY: shows skill gaps (high demand, low supply) on the admin dashboard.
SELECT s.name AS skill, s.category,
       count(DISTINCT js.job_id)        AS jobs_requiring,
       count(DISTINCT cs.candidate_id)  AS candidates_with_skill
FROM skills s
JOIN job_skills js            ON js.skill_id = s.skill_id AND js.is_required
LEFT JOIN candidate_skills cs ON cs.skill_id = s.skill_id
GROUP BY s.skill_id, s.name, s.category
HAVING count(DISTINCT js.job_id) >= 2
ORDER BY jobs_requiring DESC, candidates_with_skill;

\echo '\n=== Q11 Average days spent between stages (history analytics) ==='
-- DEMONSTRATES: window function LAG over the audit table, date arithmetic,
--               GROUP BY on derived columns.
-- RETURNS: for each transition (e.g. applied -> shortlisted), how many times
--          it happened and the average days it took.
-- WHY: "time to shortlist" / "time to offer" hiring KPIs.
WITH steps AS (
    SELECT h.old_status, h.new_status,
           h.changed_at - lag(h.changed_at) OVER (PARTITION BY h.application_id
                                                  ORDER BY h.changed_at) AS took
    FROM application_status_history h
)
SELECT old_status || ' -> ' || new_status AS transition,
       count(*) AS times,
       round(avg(extract(epoch FROM took) / 86400)::numeric, 1) AS avg_days
FROM steps
WHERE old_status IS NOT NULL
GROUP BY old_status, new_status
ORDER BY avg_days;

\echo '\n=== Q12 Recruiter workload (JOIN + GROUP BY + ORDER BY) ==='
-- DEMONSTRATES: multi-table JOIN, COUNT(DISTINCT), FILTER, ORDER BY.
-- RETURNS: per recruiter: jobs owned, applications to review, interviews.
-- WHY: admins balance work between recruiters.
SELECT u.full_name AS recruiter, c.name AS company,
       count(DISTINCT j.job_id)                                         AS jobs,
       count(a.application_id)                                          AS applications,
       count(a.application_id) FILTER (WHERE a.status = 'applied')      AS awaiting_review,
       (SELECT count(*) FROM interviews i WHERE i.interviewer_id = r.user_id) AS interviews
FROM recruiters r
JOIN users u          ON u.user_id = r.user_id
JOIN companies c      ON c.company_id = r.company_id
LEFT JOIN jobs j      ON j.recruiter_id = r.user_id
LEFT JOIN applications a ON a.job_id = j.job_id
GROUP BY r.user_id, u.full_name, c.name
ORDER BY awaiting_review DESC, applications DESC;

\echo '\n=== Q13 Upcoming interviews (JOIN + date filter + ORDER BY) ==='
-- DEMONSTRATES: 4-table JOIN, timestamp comparison with now(), ORDER BY.
-- RETURNS: scheduled interviews in the future, soonest first.
-- WHY: recruiter and candidate dashboards ("Your next interview").
SELECT i.scheduled_at, i.round_no, i.mode, cu.full_name AS candidate, j.title AS job
FROM interviews i
JOIN applications a ON a.application_id = i.application_id
JOIN jobs j         ON j.job_id = a.job_id
JOIN users cu       ON cu.user_id = a.candidate_id
WHERE i.status = 'scheduled' AND i.scheduled_at >= now()
ORDER BY i.scheduled_at;

\echo '\n=== Q14 Each candidate''s most recent application (correlated subquery with MAX) ==='
-- DEMONSTRATES: correlated subquery comparing each row with MAX of its group.
-- RETURNS: one row per candidate: their latest application and its status.
-- WHY: candidate list in the admin panel shows "last activity".
SELECT u.full_name, j.title, a.status, a.applied_at::date
FROM applications a
JOIN users u ON u.user_id = a.candidate_id
JOIN jobs j  ON j.job_id  = a.job_id
WHERE a.applied_at = (SELECT max(a2.applied_at) FROM applications a2
                       WHERE a2.candidate_id = a.candidate_id)
ORDER BY a.applied_at DESC;

\echo '\n=== Q15 Interview rating vs. outcome (aggregate on completed interviews) ==='
-- DEMONSTRATES: JOIN, AVG, COUNT, GROUP BY, HAVING.
-- RETURNS: average interview rating grouped by the application's current status.
-- WHY: checks whether interview scores predict who receives offers.
SELECT a.status, count(*) AS completed_interviews, round(avg(i.rating), 2) AS avg_rating
FROM interviews i
JOIN applications a ON a.application_id = i.application_id
WHERE i.status = 'completed'
GROUP BY a.status
HAVING count(*) >= 1
ORDER BY avg_rating DESC;

\echo '\n=== Q16 Using the views and the report function ==='
-- DEMONSTRATES: querying views like tables; calling a set-returning function.
-- RETURNS: company summary (view with HAVING) and one company's funnel report.
-- WHY: these are what the dashboards will call through the API.
SELECT company_name, total_jobs, open_jobs, total_applications, unique_candidates,
       rejection_rate_pct, offers_made
FROM company_hiring_summary ORDER BY total_applications DESC;

SELECT job_title, total_applications, shortlist_rate_pct, offer_rate_pct, avg_days_to_shortlist
FROM generate_hiring_pipeline_report(
       (SELECT company_id FROM companies WHERE name = 'Nimbus Analytics Pvt Ltd'));

\echo '\n=== Q17 Skill profile per candidate (GROUP BY + HAVING) ==='
-- DEMONSTRATES: JOIN through the M:N table candidate_skills, COUNT, AVG,
--               FILTER, string_agg, GROUP BY, HAVING.
-- RETURNS: candidates with at least 3 skills: how many, how many at
--          advanced level (4-5), average proficiency, and the skill list.
-- WHY: candidate dashboard summary; recruiters spot well-documented profiles.
SELECT u.full_name AS candidate,
       count(*)                                        AS skills,
       count(*) FILTER (WHERE cs.proficiency >= 4)     AS advanced_skills,
       round(avg(cs.proficiency), 2)                   AS avg_proficiency,
       string_agg(s.name, ', ' ORDER BY cs.proficiency DESC, s.name) AS skill_list
FROM candidate_skills cs
JOIN users u  ON u.user_id = cs.candidate_id
JOIN skills s ON s.skill_id = cs.skill_id
GROUP BY cs.candidate_id, u.full_name
HAVING count(*) >= 3
ORDER BY skills DESC, avg_proficiency DESC;

\echo '\n=== Q18 Skill demand vs. supply (two aggregates + HAVING) ==='
-- DEMONSTRATES: aggregating two M:N tables separately in derived tables
--               (joining both first would multiply the counts), LEFT JOIN,
--               GROUP BY, COALESCE for skills no candidate has.
-- RETURNS: skills required by at least one OPEN job, with how many open jobs
--          require them and how many candidates list them.
-- WHY: shows candidates which skills are worth adding to their profile.
SELECT s.name AS skill, s.category,
       demand.open_jobs,
       COALESCE(supply.candidates, 0) AS candidates_with_skill
FROM skills s
JOIN (SELECT js.skill_id, count(*) AS open_jobs
        FROM job_skills js JOIN jobs j ON j.job_id = js.job_id
       WHERE j.status = 'open' AND js.is_required
       GROUP BY js.skill_id) AS demand ON demand.skill_id = s.skill_id
LEFT JOIN (SELECT skill_id, count(*) AS candidates
             FROM candidate_skills GROUP BY skill_id) AS supply ON supply.skill_id = s.skill_id
ORDER BY demand.open_jobs DESC, candidates_with_skill, s.name;

\echo '\n=== Q19 Required-skill coverage of each candidate for open jobs (GROUP BY + HAVING) ==='
-- DEMONSTRATES: pairing every candidate with every open job (JOIN ON TRUE),
--               LEFT JOIN with extra conditions, COUNT of matches, HAVING on a ratio.
-- RETURNS: candidate / open-job pairs where the candidate already has at least
--          60% of the job's required skills at the required proficiency.
-- WHY: a transparent, rule-based shortlist next to the vector-based ranking.
--      (This is NOT the match score; that comes from pgvector embeddings.)
SELECT u.full_name AS candidate, j.title AS job,
       count(cs.skill_id)  AS required_skills_met,
       count(*)            AS required_skills,
       round(100.0 * count(cs.skill_id) / count(*)) AS coverage_pct
FROM jobs j
JOIN job_skills js       ON js.job_id = j.job_id AND js.is_required
JOIN candidates c        ON TRUE
JOIN users u             ON u.user_id = c.user_id
LEFT JOIN candidate_skills cs
       ON cs.candidate_id = c.user_id AND cs.skill_id = js.skill_id
      AND cs.proficiency >= js.min_proficiency
WHERE j.status = 'open'
GROUP BY u.user_id, u.full_name, j.job_id, j.title
HAVING count(cs.skill_id)::numeric / count(*) >= 0.6
ORDER BY j.title, coverage_pct DESC, u.full_name;

\echo '\n=== Q20 Semantic ranking: top candidates for the ML Engineer job (pgvector) ==='
-- DEMONSTRATES: calling a set-returning PL/pgSQL function (migration 015) that
--               does a vector similarity search with the cosine distance
--               operator <=>, joined with relational data (users, candidates,
--               job_skills, candidate_skills, applications).
-- RETURNS: candidates ranked by similarity = 1 - (primary resume embedding
--          <=> job embedding), with experience, required-skill matches and
--          whether they applied.
-- WHY: the recruiter "Best matches" list (GET /api/recruiter/jobs/:id/matches).
--      Needs embeddings: run `npm run db:embed` after seeding.
SELECT full_name, years_experience, similarity, matched_skills, required_skills, has_applied
FROM rank_candidates_for_job(
         (SELECT job_id FROM jobs WHERE title = 'Machine Learning Engineer'), 5, FALSE);

\echo '\n=== Q21 Same ranking restricted to the job''s applicants ==='
-- DEMONSTRATES: the p_applicants_only flag (EXISTS filter inside the function).
-- RETURNS: only candidates who applied to the job, best semantic match first.
-- WHY: screening the applicant pool instead of sourcing new people.
SELECT full_name, similarity, matched_skills || '/' || required_skills AS skills, has_applied
FROM rank_candidates_for_job(
         (SELECT job_id FROM jobs WHERE title = 'Machine Learning Engineer'), 10, TRUE);

\echo '\n=== Q22 Reverse direction: best open jobs for one candidate (raw k-NN query) ==='
-- DEMONSTRATES: the k-nearest-neighbour pattern ORDER BY embedding <=> vector
--               LIMIT k written out by hand (the shape the HNSW index with
--               vector_cosine_ops serves), scalar subquery for the query
--               vector, JOIN to filter by a relational column (status = 'open').
-- RETURNS: the 3 open jobs whose embeddings are closest to Aditi's primary resume.
-- WHY: "Recommended jobs" for a candidate.
SELECT j.title, c.name AS company,
       round((1 - (je.embedding <=> q.v))::numeric, 4) AS similarity
FROM job_embeddings je
JOIN jobs j      ON j.job_id = je.job_id AND j.status = 'open'
JOIN companies c ON c.company_id = j.company_id
CROSS JOIN (SELECT re.embedding AS v
              FROM resume_embeddings re
              JOIN resumes r ON r.resume_id = re.resume_id AND r.is_primary
              JOIN users u   ON u.user_id = r.candidate_id
             WHERE u.email = 'aditi.sharma@mail.example') AS q
ORDER BY je.embedding <=> q.v
LIMIT 3;

\echo '\n=== Q23 Apply-to-job transaction (same steps as src/lib/applications.js) ==='
-- DEMONSTRATES: explicit transaction BEGIN ... COMMIT/ROLLBACK, row lock
--               SELECT ... FOR SHARE, INSERT ... SELECT ... RETURNING, a
--               stored function inside INSERT (compute_match_score), and three
--               triggers firing INSIDE the transaction (initial-status guard,
--               applicant_count, status history).
-- RETURNS: the new application with its real cosine match score, the
--          trigger-updated applicant_count and history row as seen INSIDE the
--          transaction, then the count after ROLLBACK (back to the original).
-- WHY: POST /api/candidate/applications. The app ends with COMMIT; this file
--      ends with ROLLBACK so it stays read-only and can be re-run.
BEGIN;
SELECT job_id, title, status, applicant_count AS count_before
  FROM jobs WHERE title = 'Data Analyst'
   FOR SHARE;                                  -- nobody can close it until we finish
INSERT INTO applications (job_id, candidate_id, resume_id, match_score)
SELECT j.job_id, u.user_id, r.resume_id, compute_match_score(r.resume_id, j.job_id)
  FROM jobs j
 CROSS JOIN users u
  JOIN resumes r ON r.candidate_id = u.user_id AND r.is_primary
 WHERE j.title = 'Data Analyst' AND j.status = 'open'
   AND u.email = 'ananya.gupta@mail.example'
RETURNING application_id, status, match_score;
INSERT INTO notifications (user_id, type, title, message, related_application_id)
SELECT j.recruiter_id, 'application_submitted', 'New application: ' || j.title,
       u.full_name || ' applied for ' || j.title || '.', a.application_id
  FROM applications a
  JOIN jobs j  ON j.job_id = a.job_id
  JOIN users u ON u.user_id = a.candidate_id
 WHERE j.title = 'Data Analyst' AND u.email = 'ananya.gupta@mail.example';
SELECT j.applicant_count AS count_inside_txn, h.old_status, h.new_status, h.note
  FROM jobs j
  JOIN applications a ON a.job_id = j.job_id
  JOIN users u        ON u.user_id = a.candidate_id AND u.email = 'ananya.gupta@mail.example'
  JOIN application_status_history h ON h.application_id = a.application_id
 WHERE j.title = 'Data Analyst';
ROLLBACK;                                      -- the app runs COMMIT here
SELECT applicant_count AS count_after_rollback FROM jobs WHERE title = 'Data Analyst';

\echo '\n=== Q24 Skill gap: required skills a candidate has vs is missing (EXCEPT) ==='
-- DEMONSTRATES: set difference with EXCEPT, JOIN with a comparison column
--               (proficiency >= min_proficiency).
-- RETURNS: for Aman and the ML Engineer job, each required skill labelled
--          have / below level / missing. "missing" comes from
--          job_skills EXCEPT candidate_skills.
-- WHY: the "Skill gap" panel on the candidate job page
--      (src/lib/candidate/skill-gap.js runs the same two queries).
WITH params AS (
    SELECT (SELECT job_id  FROM jobs  WHERE title = 'Machine Learning Engineer') AS job_id,
           (SELECT user_id FROM users WHERE email = 'aman.malhotra@mail.example') AS candidate_id
)
SELECT s.name AS skill, js.min_proficiency AS needed, cs.proficiency AS has,
       CASE WHEN cs.proficiency >= js.min_proficiency THEN 'have' ELSE 'have (below level)' END AS gap
  FROM params p
  JOIN job_skills js       ON js.job_id = p.job_id AND js.is_required
  JOIN skills s            ON s.skill_id = js.skill_id
  JOIN candidate_skills cs ON cs.skill_id = js.skill_id AND cs.candidate_id = p.candidate_id
UNION ALL
SELECT s.name, js.min_proficiency, NULL, 'missing'
  FROM params p
  JOIN (SELECT js.skill_id FROM job_skills js, params p
         WHERE js.job_id = p.job_id AND js.is_required
        EXCEPT
        SELECT cs.skill_id FROM candidate_skills cs, params p
         WHERE cs.candidate_id = p.candidate_id) AS gap ON TRUE
  JOIN skills s      ON s.skill_id = gap.skill_id
  JOIN job_skills js ON js.job_id = p.job_id AND js.skill_id = gap.skill_id
ORDER BY gap, skill;

\echo '\n=== Q25 match_score is a real cosine similarity (compute_match_score check) ==='
-- DEMONSTRATES: calling a SQL function per row, pgvector <=>, aggregate check.
-- RETURNS: how many applications are scored, and the largest difference
--          between the stored score and 1 - (resume <=> job) recomputed now
--          (≤ 0.00005, the 4-decimal rounding).
-- WHY: proves no score is faked (rule: scores must come from pgvector).
SELECT count(*)                                        AS applications,
       count(a.match_score)                            AS scored,
       max(abs(a.match_score - (1 - (re.embedding <=> je.embedding))))::numeric(10,8) AS max_difference,
       bool_and(a.match_score = compute_match_score(a.resume_id, a.job_id)) AS all_equal_function
  FROM applications a
  LEFT JOIN resume_embeddings re ON re.resume_id = a.resume_id
  LEFT JOIN job_embeddings je    ON je.job_id = a.job_id;

\echo '\n=== Q26 Recruiter applicant ranking for one job ==='
-- DEMONSTRATES: ORDER BY ... DESC NULLS LAST, correlated array_agg
--               subqueries, LEFT JOIN.
-- RETURNS: applicants of the ML Engineer job, best match score first, with
--          matched / required skill names side by side.
-- WHY: the "Ranked applicants" tab (GET /api/recruiter/jobs/:id/applications).
SELECT u.full_name, a.status, a.match_score,
       (SELECT string_agg(s.name, ', ' ORDER BY s.name)
          FROM job_skills js
          JOIN skills s ON s.skill_id = js.skill_id
          JOIN candidate_skills cs ON cs.skill_id = js.skill_id AND cs.candidate_id = a.candidate_id
         WHERE js.job_id = a.job_id AND js.is_required AND cs.proficiency >= js.min_proficiency) AS matched,
       (SELECT string_agg(s.name, ', ' ORDER BY s.name)
          FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
         WHERE js.job_id = a.job_id AND js.is_required) AS required
  FROM applications a
  JOIN users u ON u.user_id = a.candidate_id
 WHERE a.job_id = (SELECT job_id FROM jobs WHERE title = 'Machine Learning Engineer')
 ORDER BY a.match_score DESC NULLS LAST, a.applied_at;
