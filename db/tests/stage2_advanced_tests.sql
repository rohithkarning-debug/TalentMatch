-- Stage 2 tests: triggers, functions and views.
-- Everything runs inside ONE transaction that is rolled back at the end, so
-- the seeded data is left exactly as it was. Each test is a DO block with
-- ASSERTs: a wrong result aborts the script with an error.
--
-- Run (PowerShell, from the project root):
--   Get-Content db/tests/stage2_advanced_tests.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- Helpers for readable lookups (temporary: dropped at ROLLBACK)
CREATE FUNCTION pg_temp.uid(p_email TEXT) RETURNS BIGINT LANGUAGE sql AS
    $$ SELECT user_id FROM users WHERE email = p_email $$;
CREATE FUNCTION pg_temp.jid(p_title TEXT) RETURNS BIGINT LANGUAGE sql AS
    $$ SELECT job_id FROM jobs WHERE title = p_title $$;
CREATE FUNCTION pg_temp.cnt(p_job BIGINT) RETURNS INT LANGUAGE sql AS
    $$ SELECT applicant_count FROM jobs WHERE job_id = p_job $$;

\echo '--- T1  INSERT application increments applicant_count + logs initial history'
DO $$
DECLARE
    v_job BIGINT := pg_temp.jid('Backend Engineer (Node.js)');
    v_cand BIGINT := pg_temp.uid('vikram.chauhan@mail.example');
    v_before INT := pg_temp.cnt(v_job);
    v_app BIGINT;
    h application_status_history;
BEGIN
    INSERT INTO applications (job_id, candidate_id) VALUES (v_job, v_cand)
    RETURNING application_id INTO v_app;
    ASSERT pg_temp.cnt(v_job) = v_before + 1, 'count not incremented';
    SELECT * INTO h FROM application_status_history WHERE application_id = v_app;
    ASSERT h.old_status IS NULL AND h.new_status = 'applied' AND h.changed_by = v_cand,
           'initial history row wrong';
    RAISE NOTICE 'PASS T1: applicant_count % -> %, history (NULL -> applied) by candidate %',
                 v_before, pg_temp.cnt(v_job), v_cand;
END $$;

\echo '--- T2  DELETE application decrements applicant_count'
DO $$
DECLARE
    v_job BIGINT := pg_temp.jid('Backend Engineer (Node.js)');
    v_before INT := pg_temp.cnt(v_job);
BEGIN
    DELETE FROM applications
     WHERE job_id = v_job AND candidate_id = pg_temp.uid('vikram.chauhan@mail.example');
    ASSERT pg_temp.cnt(v_job) = v_before - 1, 'count not decremented';
    RAISE NOTICE 'PASS T2: applicant_count % -> %', v_before, pg_temp.cnt(v_job);
END $$;

\echo '--- T3  Moving an application to another job: -1 old job, +1 new job; status UPDATE does not double count'
DO $$
DECLARE
    v_old BIGINT := pg_temp.jid('DevOps Engineer');
    v_new BIGINT := pg_temp.jid('Backend Engineer (Node.js)');
    v_old_before INT := pg_temp.cnt(v_old);
    v_new_before INT := pg_temp.cnt(v_new);
    v_app BIGINT;
BEGIN
    SELECT application_id INTO v_app FROM applications
     WHERE job_id = v_old AND candidate_id = pg_temp.uid('siddharth.pillai@mail.example');
    UPDATE applications SET job_id = v_new WHERE application_id = v_app;
    ASSERT pg_temp.cnt(v_old) = v_old_before - 1 AND pg_temp.cnt(v_new) = v_new_before + 1, 'move miscounted';
    -- an update that does not touch job_id must not change any count
    UPDATE applications SET cover_letter = 'edited' WHERE application_id = v_app;
    ASSERT pg_temp.cnt(v_new) = v_new_before + 1, 'non-job update changed the count';
    UPDATE applications SET job_id = v_old WHERE application_id = v_app;   -- move back
    ASSERT pg_temp.cnt(v_old) = v_old_before AND pg_temp.cnt(v_new) = v_new_before, 'move back miscounted';
    RAISE NOTICE 'PASS T3: old job % -> % -> %, new job % -> % -> %',
        v_old_before, v_old_before - 1, pg_temp.cnt(v_old), v_new_before, v_new_before + 1, pg_temp.cnt(v_new);
END $$;

\echo '--- T4  Status change is recorded in application_status_history (with actor + note)'
DO $$
DECLARE
    v_app BIGINT;
    v_recruiter BIGINT := pg_temp.uid('arjun.rao@nimbusanalytics.example');
    h application_status_history;
BEGIN
    SELECT application_id INTO v_app FROM applications
     WHERE job_id = pg_temp.jid('Data Analyst') AND candidate_id = pg_temp.uid('farhan.qureshi@mail.example');
    PERFORM set_config('talentmatch.actor_id', v_recruiter::text, true);
    PERFORM set_config('talentmatch.status_note', 'Good SQL test score', true);
    UPDATE applications SET status = 'shortlisted' WHERE application_id = v_app;
    PERFORM set_config('talentmatch.actor_id', '', true);
    PERFORM set_config('talentmatch.status_note', '', true);
    SELECT * INTO h FROM application_status_history
     WHERE application_id = v_app ORDER BY history_id DESC LIMIT 1;
    ASSERT h.old_status = 'applied' AND h.new_status = 'shortlisted'
       AND h.changed_by = v_recruiter AND h.note = 'Good SQL test score', 'history row wrong';
    RAISE NOTICE 'PASS T4: history row % : % -> % by user %, note "%"',
                 h.history_id, h.old_status, h.new_status, h.changed_by, h.note;
END $$;

\echo '--- T5  Invalid status transitions are rejected by the BEFORE UPDATE trigger'
DO $$
DECLARE
    v_app BIGINT;
    t RECORD;
    v_hist_before BIGINT;
    v_rejected INT := 0;
BEGIN
    SELECT count(*) INTO v_hist_before FROM application_status_history;
    FOR t IN SELECT * FROM (VALUES
        ('vikram.chauhan@mail.example',   'Frontend Developer (React / Next.js)', 'offered'),      -- applied -> offered (skip)
        ('vikram.chauhan@mail.example',   'Frontend Developer (React / Next.js)', 'interviewed'),  -- applied -> interviewed (skip)
        ('aman.malhotra@mail.example',    'Machine Learning Engineer',            'shortlisted'),  -- rejected -> shortlisted (terminal)
        ('rohan.verma@mail.example',      'Machine Learning Engineer',            'interviewed'),  -- offered -> interviewed (backwards)
        ('sneha.kulkarni@mail.example',   'Frontend Developer (React / Next.js)', 'applied')       -- interviewed -> applied (backwards)
    ) AS v(email, title, new_status) LOOP
        SELECT application_id INTO v_app FROM applications
         WHERE job_id = pg_temp.jid(t.title) AND candidate_id = pg_temp.uid(t.email);
        BEGIN
            UPDATE applications SET status = t.new_status WHERE application_id = v_app;
            RAISE EXCEPTION 'FAIL: % -> % was accepted', t.email, t.new_status;
        EXCEPTION WHEN check_violation THEN
            v_rejected := v_rejected + 1;
            RAISE NOTICE '  rejected as expected: %', SQLERRM;
        END;
    END LOOP;
    ASSERT v_rejected = 5;
    ASSERT (SELECT count(*) FROM application_status_history) = v_hist_before, 'history written for rejected change';
    RAISE NOTICE 'PASS T5: 5/5 invalid transitions rejected, no history rows written';
END $$;

\echo '--- T6  Full valid path applied -> shortlisted -> interviewed -> offered -> rejected works; no-op update logs nothing'
DO $$
DECLARE
    v_app BIGINT;
    s TEXT;
    v_hist BIGINT;
BEGIN
    SELECT application_id INTO v_app FROM applications
     WHERE job_id = pg_temp.jid('NLP Research Intern') AND candidate_id = pg_temp.uid('divya.krishnan@mail.example');
    FOREACH s IN ARRAY ARRAY['shortlisted', 'interviewed', 'offered', 'rejected'] LOOP
        UPDATE applications SET status = s WHERE application_id = v_app;
    END LOOP;
    SELECT count(*) INTO v_hist FROM application_status_history WHERE application_id = v_app;
    UPDATE applications SET status = 'rejected' WHERE application_id = v_app;  -- same value
    ASSERT (SELECT count(*) FROM application_status_history WHERE application_id = v_app) = v_hist,
           'no-op status update wrote history';
    ASSERT v_hist = 5, 'expected 1 initial + 4 transitions';
    RAISE NOTICE 'PASS T6: % history rows for the full path; same-status update ignored', v_hist;
END $$;

\echo '--- T7  New applications must start as applied'
DO $$
BEGIN
    INSERT INTO applications (job_id, candidate_id, status)
    VALUES (pg_temp.jid('DevOps Engineer'), pg_temp.uid('aman.malhotra@mail.example'), 'offered');
    RAISE EXCEPTION 'FAIL: inserted directly as offered';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS T7: %', SQLERRM;
END $$;

\echo '--- T8  updated_at maintenance'
DO $$
DECLARE
    v_job BIGINT := pg_temp.jid('Data Analyst');
    v_app BIGINT;
    v_t0 TIMESTAMPTZ; v_t1 TIMESTAMPTZ;
BEGIN
    -- Put an old value in first so the change is visible (now() is the txn
    -- start time). An UPDATE that changes ONLY updated_at counts as "nothing
    -- else changed", so the trigger keeps the value we set.
    UPDATE jobs SET updated_at = '2026-01-01' WHERE job_id = v_job;

    -- (a) real edit -> updated_at refreshed
    UPDATE jobs SET openings = openings + 1 WHERE job_id = v_job;
    SELECT updated_at INTO v_t1 FROM jobs WHERE job_id = v_job;
    ASSERT v_t1 = now(), 'jobs.updated_at not refreshed';
    RAISE NOTICE 'PASS T8a: jobs.updated_at 2026-01-01 -> % after editing openings', v_t1;

    -- (b) no-op update -> unchanged
    UPDATE jobs SET updated_at = '2026-01-01' WHERE job_id = v_job;
    UPDATE jobs SET title = title WHERE job_id = v_job;
    ASSERT (SELECT updated_at FROM jobs WHERE job_id = v_job) = '2026-01-01', 'no-op update bumped updated_at';
    RAISE NOTICE 'PASS T8b: no-op UPDATE left jobs.updated_at at 2026-01-01';

    -- (c) applicant_count changes (via the counter trigger) are ignored
    INSERT INTO applications (job_id, candidate_id) VALUES (v_job, pg_temp.uid('neha.bhatt@mail.example'));
    ASSERT (SELECT updated_at FROM jobs WHERE job_id = v_job) = '2026-01-01', 'counter change bumped updated_at';
    RAISE NOTICE 'PASS T8c: new application changed applicant_count but not jobs.updated_at';

    -- (d) applications.updated_at follows a status change
    SELECT application_id, updated_at INTO v_app, v_t0 FROM applications
     WHERE job_id = pg_temp.jid('Backend Engineer (Node.js)') AND candidate_id = pg_temp.uid('ananya.gupta@mail.example');
    UPDATE applications SET status = 'shortlisted' WHERE application_id = v_app;
    SELECT updated_at INTO v_t1 FROM applications WHERE application_id = v_app;
    ASSERT v_t1 > v_t0, 'applications.updated_at not refreshed';
    RAISE NOTICE 'PASS T8d: applications.updated_at % -> %', v_t0, v_t1;

    -- (e) candidates.updated_at on a profile edit
    UPDATE candidates SET headline = headline || ' (open to relocation)'
     WHERE user_id = pg_temp.uid('farhan.qureshi@mail.example');
    ASSERT (SELECT updated_at FROM candidates WHERE user_id = pg_temp.uid('farhan.qureshi@mail.example')) = now();
    RAISE NOTICE 'PASS T8e: candidates.updated_at refreshed on profile edit';
END $$;

\echo '--- T9  update_application_status(): success path, permissions, validation, atomicity'
DO $$
DECLARE
    v_app BIGINT;
    v_kavya BIGINT := pg_temp.uid('kavya.menon@kestrellabs.example');   -- Kestrel recruiter
    v_meera BIGINT := pg_temp.uid('meera.iyer@nimbusanalytics.example'); -- Nimbus recruiter
    r applications;
    h application_status_history;
    v_notif BIGINT;
BEGIN
    SELECT application_id INTO v_app FROM applications
     WHERE job_id = pg_temp.jid('Frontend Developer (React / Next.js)')
       AND candidate_id = pg_temp.uid('aman.malhotra@mail.example');           -- currently shortlisted
    SELECT count(*) INTO v_notif FROM notifications WHERE related_application_id = v_app;

    -- success: Kestrel recruiter moves a Kestrel application forward
    r := update_application_status(v_app, 'interviewed', v_kavya, 'Technical round cleared');
    SELECT * INTO h FROM application_status_history WHERE application_id = v_app ORDER BY history_id DESC LIMIT 1;
    ASSERT r.status = 'interviewed' AND h.changed_by = v_kavya AND h.note = 'Technical round cleared';
    ASSERT (SELECT count(*) FROM notifications WHERE related_application_id = v_app) = v_notif + 1;
    RAISE NOTICE 'PASS T9a: status=% history=(% -> % by %, "%") + 1 notification',
                 r.status, h.old_status, h.new_status, h.changed_by, h.note;

    -- wrong company recruiter
    BEGIN
        PERFORM update_application_status(v_app, 'offered', v_meera);
        RAISE EXCEPTION 'FAIL: other-company recruiter allowed';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS T9b: %', SQLERRM; END;

    -- candidate cannot change status
    BEGIN
        PERFORM update_application_status(v_app, 'offered', pg_temp.uid('aman.malhotra@mail.example'));
        RAISE EXCEPTION 'FAIL: candidate allowed';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS T9c: %', SQLERRM; END;

    -- unknown status
    BEGIN
        PERFORM update_application_status(v_app, 'hired', v_kavya);
        RAISE EXCEPTION 'FAIL: unknown status accepted';
    EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS T9d: %', SQLERRM; END;

    -- application does not exist
    BEGIN
        PERFORM update_application_status(999999, 'shortlisted', v_kavya);
        RAISE EXCEPTION 'FAIL: missing application accepted';
    EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'PASS T9e: %', SQLERRM; END;

    -- invalid transition is rejected by the trigger and NOTHING is saved
    -- (no status change, no history row, no notification)
    SELECT count(*) INTO v_notif FROM notifications WHERE related_application_id = v_app;
    BEGIN
        PERFORM update_application_status(v_app, 'applied', v_kavya);
        RAISE EXCEPTION 'FAIL: backwards transition accepted';
    EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS T9f: %', SQLERRM; END;
    ASSERT (SELECT status FROM applications WHERE application_id = v_app) = 'interviewed';
    ASSERT (SELECT count(*) FROM notifications WHERE related_application_id = v_app) = v_notif;
    RAISE NOTICE 'PASS T9g: failed call left status, history and notifications untouched';

    -- admin may update any application
    r := update_application_status(v_app, 'offered', pg_temp.uid('admin@talentmatch.example'), 'Approved by admin');
    ASSERT r.status = 'offered';
    RAISE NOTICE 'PASS T9h: admin moved application to %', r.status;
END $$;

\echo '--- T10 generate_hiring_pipeline_report(): totals, filters, validation'
DO $$
DECLARE
    v_rows INT; v_total BIGINT; v_nimbus INT;
BEGIN
    SELECT count(*), sum(total_applications) INTO v_rows, v_total FROM generate_hiring_pipeline_report();
    ASSERT v_rows = (SELECT count(*) FROM jobs), 'one row per job expected';
    ASSERT v_total = (SELECT count(*) FROM applications), 'application total mismatch';
    SELECT count(*) INTO v_nimbus FROM generate_hiring_pipeline_report(
        (SELECT company_id FROM companies WHERE name = 'Nimbus Analytics Pvt Ltd'));
    ASSERT v_nimbus = 3;
    RAISE NOTICE 'PASS T10a: % job rows, % applications total; Nimbus filter -> % rows', v_rows, v_total, v_nimbus;
    BEGIN
        PERFORM generate_hiring_pipeline_report(NULL, DATE '2026-10-01', DATE '2026-09-01');
        RAISE EXCEPTION 'FAIL: bad range accepted';
    EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS T10b: %', SQLERRM; END;
    BEGIN
        PERFORM generate_hiring_pipeline_report(424242);
        RAISE EXCEPTION 'FAIL: unknown company accepted';
    EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'PASS T10c: %', SQLERRM; END;
END $$;

\echo '--- T11 Views agree with the base tables (no double counting)'
DO $$
BEGIN
    ASSERT NOT EXISTS (SELECT 1 FROM recruiter_pipeline_view v JOIN jobs j USING (job_id)
                        WHERE v.total_applications <> j.applicant_count), 'pipeline view != applicant_count';
    ASSERT (SELECT count(*) FROM recruiter_pipeline_view) = (SELECT count(*) FROM jobs);
    ASSERT (SELECT count(*) FROM candidate_application_view) = (SELECT count(*) FROM applications);
    ASSERT (SELECT sum(total_applications) FROM company_hiring_summary) = (SELECT count(*) FROM applications);
    ASSERT (SELECT sum(offers_made) FROM company_hiring_summary) = (SELECT count(*) FROM offers);
    RAISE NOTICE 'PASS T11: all three views consistent with base tables';
END $$;

\echo '--- T11b company_hiring_summary HAVING excludes a company whose jobs have no applications'
DO $$
DECLARE v_co BIGINT;
BEGIN
    INSERT INTO companies (name, industry) VALUES ('Quietwave Test Labs', 'Testing') RETURNING company_id INTO v_co;
    INSERT INTO jobs (company_id, title, description, location)
    VALUES (v_co, 'QA Engineer', 'Temporary job with no applicants, used to test the HAVING clause in Stage 2.', 'Pune');
    ASSERT NOT EXISTS (SELECT 1 FROM company_hiring_summary WHERE company_id = v_co), 'HAVING did not filter';
    ASSERT EXISTS (SELECT 1 FROM recruiter_pipeline_view v JOIN jobs j USING (job_id) WHERE j.company_id = v_co),
           'pipeline view should still list the empty job';
    RAISE NOTICE 'PASS T11b: company with 0 applications hidden by HAVING (still visible per job in recruiter_pipeline_view)';
END $$;

\echo '--- T12 Cascade delete of a candidate decrements every affected job'
DO $$
DECLARE
    v_ml BIGINT := pg_temp.jid('Machine Learning Engineer');
    v_fe BIGINT := pg_temp.jid('Frontend Developer (React / Next.js)');
    v_ml0 INT := pg_temp.cnt(v_ml); v_fe0 INT := pg_temp.cnt(v_fe);
BEGIN
    DELETE FROM users WHERE email = 'aman.malhotra@mail.example';  -- cascades to candidate -> applications
    ASSERT pg_temp.cnt(v_ml) = v_ml0 - 1 AND pg_temp.cnt(v_fe) = v_fe0 - 1;
    RAISE NOTICE 'PASS T12: ML Engineer % -> %, Frontend % -> %', v_ml0, pg_temp.cnt(v_ml), v_fe0, pg_temp.cnt(v_fe);
END $$;

\echo '--- T13 TRUNCATE applications resets every applicant_count to 0'
DO $$
BEGIN
    TRUNCATE applications CASCADE;
    ASSERT NOT EXISTS (SELECT 1 FROM jobs WHERE applicant_count <> 0);
    RAISE NOTICE 'PASS T13: all applicant_count values are 0 after TRUNCATE';
END $$;

ROLLBACK;
\echo '=== All Stage 2 tests passed; transaction rolled back (seed data unchanged) ==='
