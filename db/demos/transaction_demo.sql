-- ============================================================================
-- TalentMatch — Transaction demonstration (COMMIT vs ROLLBACK)
--
-- Uses a DISPOSABLE fictional candidate (txn.demo@mail.example). Part A
-- commits, shows the data persisted, then deletes the disposable user again.
-- Part B fails on purpose and rolls back. Seeded data ends up unchanged.
--
-- Run (PowerShell, from the project root):
--   Get-Content db/demos/transaction_demo.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
-- ============================================================================
\set ON_ERROR_STOP off
\pset pager off
\set demo_hash '''$2b$10$qYCMCdmT.qdfC2q8kd4WZuYcxb3.8emfuj2VIVZnakezYQb7rgtyC'''

\echo '\n##### BEFORE #####'
SELECT title, applicant_count FROM jobs WHERE title = 'Data Analyst';
SELECT count(*) AS demo_users FROM users WHERE email LIKE 'txn.demo%';

-- ---------------------------------------------------------------------------
\echo '\n##### PART A: successful transaction -> COMMIT #####'
-- "Register a candidate and submit an application" must be all-or-nothing:
-- a users row without its candidates row (or vice versa) would be corrupt.
BEGIN;
  INSERT INTO users (email, password_hash, full_name, role)
  VALUES ('txn.demo@mail.example', :demo_hash, 'Txn Demo Candidate', 'candidate');

  INSERT INTO candidates (user_id, headline, years_experience)
  SELECT user_id, 'Disposable demo profile', 1 FROM users WHERE email = 'txn.demo@mail.example';

  INSERT INTO applications (job_id, candidate_id)
  SELECT j.job_id, u.user_id FROM jobs j, users u
  WHERE j.title = 'Data Analyst' AND u.email = 'txn.demo@mail.example';
COMMIT;

\echo '-- After COMMIT (new statements see the data, so it was persisted):'
SELECT u.email, c.headline, a.status, j.title, j.applicant_count
FROM users u
JOIN candidates c   ON c.user_id = u.user_id
JOIN applications a ON a.candidate_id = u.user_id
JOIN jobs j         ON j.job_id = a.job_id
WHERE u.email = 'txn.demo@mail.example';
\echo '-- Trigger-written history row for the committed application:'
SELECT h.old_status, h.new_status, h.note
FROM application_status_history h
JOIN applications a ON a.application_id = h.application_id
JOIN users u ON u.user_id = a.candidate_id
WHERE u.email = 'txn.demo@mail.example';

\echo '-- Cleanup of the disposable record (its own committed transaction).'
\echo '-- ON DELETE CASCADE removes candidate, application and history; the trigger decrements applicant_count.'
DELETE FROM users WHERE email = 'txn.demo@mail.example';
SELECT title, applicant_count FROM jobs WHERE title = 'Data Analyst';

-- ---------------------------------------------------------------------------
\echo '\n##### PART B: failing transaction -> ROLLBACK #####'
BEGIN;
  INSERT INTO users (email, password_hash, full_name, role)
  VALUES ('txn.demo2@mail.example', :demo_hash, 'Txn Demo Two', 'candidate');

  INSERT INTO candidates (user_id, headline)
  SELECT user_id, 'Should never be saved' FROM users WHERE email = 'txn.demo2@mail.example';

  INSERT INTO applications (job_id, candidate_id)
  SELECT j.job_id, u.user_id FROM jobs j, users u
  WHERE j.title = 'Data Analyst' AND u.email = 'txn.demo2@mail.example';

  \echo '-- Inside the transaction (uncommitted), the new rows are visible:'
  SELECT u.email, j.applicant_count
  FROM users u, jobs j WHERE u.email = 'txn.demo2@mail.example' AND j.title = 'Data Analyst';

  \echo '-- Controlled failure: apply to the same job again -> UNIQUE (job_id, candidate_id) violation'
  INSERT INTO applications (job_id, candidate_id)
  SELECT j.job_id, u.user_id FROM jobs j, users u
  WHERE j.title = 'Data Analyst' AND u.email = 'txn.demo2@mail.example';

  \echo '-- Once a statement fails, PostgreSQL refuses further work in this transaction:'
  SELECT 1;
ROLLBACK;

\echo '-- After ROLLBACK: nothing from Part B exists and applicant_count is unchanged:'
SELECT count(*) AS demo2_users FROM users WHERE email = 'txn.demo2@mail.example';
SELECT count(*) AS demo2_candidates FROM candidates c JOIN users u USING (user_id) WHERE u.email = 'txn.demo2@mail.example';
SELECT title, applicant_count FROM jobs WHERE title = 'Data Analyst';

-- ---------------------------------------------------------------------------
\echo '\n##### PART C: SAVEPOINT -> undo only part of a transaction #####'
-- A savepoint is a "checkpoint" inside a transaction: after an error we can
-- roll back to it and keep the earlier work.
BEGIN;
  INSERT INTO skills (name, category) VALUES ('Txn Demo Skill', 'data');
  SAVEPOINT before_bad_insert;
  INSERT INTO skills (name, category) VALUES ('Another Demo Skill', 'not-a-category');  -- CHECK fails
  ROLLBACK TO SAVEPOINT before_bad_insert;
  \echo '-- Rolled back to the savepoint; the first insert is still there inside the transaction:'
  SELECT name, category FROM skills WHERE name LIKE '%Demo Skill';
ROLLBACK;   -- discard the whole demo
\echo '-- After the final ROLLBACK neither demo skill exists:'
SELECT count(*) AS demo_skills FROM skills WHERE name LIKE '%Demo Skill';

\echo '\n##### AFTER (should equal BEFORE) #####'
SELECT title, applicant_count FROM jobs WHERE title = 'Data Analyst';
SELECT count(*) AS demo_users FROM users WHERE email LIKE 'txn.demo%';
