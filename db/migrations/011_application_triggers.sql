-- 011: Application workflow triggers
--   (a) jobs.applicant_count is kept equal to the real number of applications
--   (b) invalid status transitions are rejected (BEFORE UPDATE)
--   (c) every status change is written to application_status_history (AFTER)
--
-- ALLOWED STATUS TRANSITIONS (anything else is rejected):
--
--     applied ──► shortlisted ──► interviewed ──► offered
--        │             │               │             │
--        └─────────────┴───────┬───────┴─────────────┘
--                              ▼
--                          rejected   (final — no way out)
--
--   * Forward one step at a time: no skipping (applied -> offered is invalid).
--   * Any active stage may go to 'rejected' (incl. offered -> rejected when an
--     offer is withdrawn or declined).
--   * No going backwards, and 'rejected' is terminal.
--   * Setting the same status again is a no-op, not an error.
--
-- HOW changed_by AND note REACH THE HISTORY TRIGGER
--   A trigger cannot see function arguments, so the caller puts them in two
--   transaction-local settings first:
--       SELECT set_config('talentmatch.actor_id',    '<user_id>', true);
--       SELECT set_config('talentmatch.status_note', '<text>',    true);
--   update_application_status() (migration 012) does this for you.
--
-- HISTORICAL IMPORT MODE
--   The seed file inserts applications that are already 'interviewed',
--   'offered', ... together with their real past history rows (with past
--   timestamps). If the trigger also logged those inserts, history would be
--   duplicated and wrong. So the seed runs
--       SET LOCAL talentmatch.import_mode = 'on';
--   which makes ONLY the history trigger skip logging. The counter and the
--   transition guard are never skipped. The application code never sets it.

-- ---------------------------------------------------------------------------
-- Shared rule: is old -> new an allowed transition?
-- IMMUTABLE: the answer depends only on the two inputs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_valid_status_transition(p_old VARCHAR, p_new VARCHAR)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_old IS NOT DISTINCT FROM p_new THEN TRUE           -- no change
        WHEN p_old = 'applied'     THEN p_new IN ('shortlisted', 'rejected')
        WHEN p_old = 'shortlisted' THEN p_new IN ('interviewed', 'rejected')
        WHEN p_old = 'interviewed' THEN p_new IN ('offered', 'rejected')
        WHEN p_old = 'offered'     THEN p_new = 'rejected'
        ELSE FALSE                                                -- 'rejected' is final
    END;
$$;

COMMENT ON FUNCTION is_valid_status_transition(VARCHAR, VARCHAR) IS
    'Application workflow: applied->shortlisted->interviewed->offered, any active stage->rejected; rejected is terminal.';

-- ---------------------------------------------------------------------------
-- (a) applicant_count maintenance — AFTER row trigger
-- ---------------------------------------------------------------------------
-- Edge cases handled:
--   * INSERT ... ON CONFLICT DO NOTHING: skipped rows fire no row trigger,
--     so duplicates are never counted.
--   * UPDATE that does not change job_id (e.g. a status change): the trigger is
--     declared "UPDATE OF job_id" AND re-checks the values, so no double count.
--   * Application moved to another job: -1 on the old job, +1 on the new one.
--   * Candidate deleted -> applications deleted by ON DELETE CASCADE: row
--     triggers fire for cascaded deletes too, so counts go down.
--   * TRUNCATE fires no row triggers -> separate statement trigger below.
CREATE OR REPLACE FUNCTION maintain_applicant_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE jobs SET applicant_count = applicant_count + 1 WHERE job_id = NEW.job_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE jobs SET applicant_count = applicant_count - 1 WHERE job_id = OLD.job_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
        UPDATE jobs SET applicant_count = applicant_count - 1 WHERE job_id = OLD.job_id;
        UPDATE jobs SET applicant_count = applicant_count + 1 WHERE job_id = NEW.job_id;
    END IF;
    RETURN NULL;  -- return value of an AFTER trigger is ignored
END;
$$;

CREATE OR REPLACE FUNCTION reset_applicant_counts_on_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE jobs SET applicant_count = 0 WHERE applicant_count <> 0;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_applicant_count ON applications;
CREATE TRIGGER trg_applications_applicant_count
    AFTER INSERT OR DELETE OR UPDATE OF job_id ON applications
    FOR EACH ROW EXECUTE FUNCTION maintain_applicant_count();

DROP TRIGGER IF EXISTS trg_applications_truncate_count ON applications;
CREATE TRIGGER trg_applications_truncate_count
    AFTER TRUNCATE ON applications
    FOR EACH STATEMENT EXECUTE FUNCTION reset_applicant_counts_on_truncate();

-- ---------------------------------------------------------------------------
-- (b) Transition guard — BEFORE UPDATE OF status
-- Runs before the row is written, so an invalid change never reaches the table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_application_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT is_valid_status_transition(OLD.status, NEW.status) THEN
        RAISE EXCEPTION 'Invalid application status transition: % -> % (application %)',
                        OLD.status, NEW.status, OLD.application_id
            USING ERRCODE = 'check_violation',
                  HINT = 'Allowed: applied->shortlisted|rejected, shortlisted->interviewed|rejected, '
                         'interviewed->offered|rejected, offered->rejected. rejected is final.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_status_guard ON applications;
CREATE TRIGGER trg_applications_status_guard
    BEFORE UPDATE OF status ON applications
    FOR EACH ROW EXECUTE FUNCTION guard_application_status_transition();

-- ---------------------------------------------------------------------------
-- (c) Status audit — AFTER INSERT OR UPDATE OF status
-- AFTER: only rows that were really saved (and passed the guard) are logged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_application_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor BIGINT := nullif(current_setting('talentmatch.actor_id', true), '')::BIGINT;
    v_note  TEXT   := nullif(current_setting('talentmatch.status_note', true), '');
BEGIN
    IF coalesce(current_setting('talentmatch.import_mode', true), '') = 'on' THEN
        RETURN NULL;  -- seed is importing historical rows itself
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, note)
        VALUES (NEW.application_id, NULL, NEW.status,
                coalesce(v_actor, NEW.candidate_id), coalesce(v_note, 'Application submitted'));
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, note)
        VALUES (NEW.application_id, OLD.status, NEW.status, v_actor, v_note);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_status_history ON applications;
CREATE TRIGGER trg_applications_status_history
    AFTER INSERT OR UPDATE OF status ON applications
    FOR EACH ROW EXECUTE FUNCTION log_application_status_change();

-- New applications must start in 'applied' (unless the seed is importing
-- historical data). Enforced here rather than as a CHECK because a CHECK
-- cannot tell an INSERT from an UPDATE.
CREATE OR REPLACE FUNCTION guard_application_initial_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status <> 'applied'
       AND coalesce(current_setting('talentmatch.import_mode', true), '') <> 'on' THEN
        RAISE EXCEPTION 'A new application must start with status ''applied'' (got %)', NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_initial_status ON applications;
CREATE TRIGGER trg_applications_initial_status
    BEFORE INSERT ON applications
    FOR EACH ROW EXECUTE FUNCTION guard_application_initial_status();
