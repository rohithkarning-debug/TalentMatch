-- Stage 1 constraint tests. Every test runs inside BEGIN ... ROLLBACK, so the
-- seeded data is never changed. Each statement is EXPECTED to fail.
--
-- Run (PowerShell, from the project root):
--   Get-Content db/tests/stage1_constraint_tests.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
\set ON_ERROR_STOP off

\echo '=== Test 1: duplicate email (expect users_email_key) ==='
BEGIN;
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('aditi.sharma@mail.example',
        '$2b$10$qYCMCdmT.qdfC2q8kd4WZuYcxb3.8emfuj2VIVZnakezYQb7rgtyC',
        'Duplicate Test', 'candidate');
ROLLBACK;

\echo '=== Test 2: invalid application status (expect applications_status_check) ==='
BEGIN;
UPDATE applications SET status = 'hired'
WHERE application_id = (SELECT min(application_id) FROM applications);
ROLLBACK;

\echo '=== Test 3: salary_max < salary_min (expect jobs_salary_range_check) ==='
BEGIN;
INSERT INTO jobs (company_id, title, description, location, salary_min, salary_max)
SELECT company_id, 'Constraint Test Job',
       'Temporary job used only to test the salary range CHECK constraint in Stage 1.',
       'Bengaluru', 1500000, 900000
FROM companies WHERE name = 'Nimbus Analytics Pvt Ltd';
ROLLBACK;

\echo '=== Test 4: duplicate application for same job + candidate (expect applications_job_id_candidate_id_key) ==='
BEGIN;
INSERT INTO applications (job_id, candidate_id)
SELECT job_id, candidate_id FROM applications
WHERE application_id = (SELECT min(application_id) FROM applications);
ROLLBACK;

\echo '=== Test 5: foreign-key violation, application for a job that does not exist (expect applications_job_fkey) ==='
BEGIN;
INSERT INTO applications (job_id, candidate_id)
SELECT 999999, user_id FROM candidates LIMIT 1;
ROLLBACK;

\echo '=== Bonus 6: candidate profile for a RECRUITER account (expect candidates_user_fkey via (user_id, role)) ==='
BEGIN;
INSERT INTO candidates (user_id)
SELECT user_id FROM users WHERE email = 'meera.iyer@nimbusanalytics.example';
ROLLBACK;

\echo '=== Bonus 7: plaintext password (expect users_password_hash_bcrypt_check) ==='
BEGIN;
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('plaintext.test@mail.example', 'password123', 'Plaintext Test', 'candidate');
ROLLBACK;

\echo '=== Bonus 8: delete a company that still has jobs (expect recruiters_company_fkey / RESTRICT) ==='
BEGIN;
DELETE FROM companies WHERE name = 'Orbitline Cloud Systems';
ROLLBACK;
