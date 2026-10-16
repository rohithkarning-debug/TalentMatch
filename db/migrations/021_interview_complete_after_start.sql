-- 021: An interview cannot be completed before its scheduled time (Stage 9)
--
-- Bug flagged in Stage 7: a recruiter could mark tomorrow's interview as
-- 'completed' with a rating, so the record claimed an interview had happened
-- when it had not. The API and the form did not stop it, and neither did the
-- database.
--
-- New rule in trg_interviews_guard (UPDATE branch):
--   * 'completed' or 'no_show' only once scheduled_at <= now(). Both describe
--     something that happened at the interview time, so neither can be set
--     before it. ('cancelled' is allowed at any time.)
--   * the time cannot be changed in the same UPDATE that completes the
--     interview, so "move it into the past and complete it" in one statement
--     is refused too.
--
-- Why a trigger and not a CHECK: a CHECK must give the same answer forever,
-- and now() keeps moving (same reason as in 018). The check runs only at the
-- moment of the change.
--
-- Everything else is unchanged from 019 (migrations already applied are
-- never edited, so the whole function is replaced here).

CREATE OR REPLACE FUNCTION guard_interview_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_app_status VARCHAR;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF coalesce(current_setting('talentmatch.import_mode', true), '') = 'on' THEN
            RETURN NEW;  -- seed imports past interviews
        END IF;
        IF NEW.status <> 'scheduled' THEN
            RAISE EXCEPTION 'A new interview must start with status ''scheduled'' (got %)', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.scheduled_at <= now() THEN
            RAISE EXCEPTION 'Interview must be scheduled in the future (got %)', NEW.scheduled_at
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT status INTO v_app_status FROM applications WHERE application_id = NEW.application_id;
        IF v_app_status NOT IN ('shortlisted', 'interviewed') THEN
            RAISE EXCEPTION 'Interviews can only be scheduled for shortlisted or interviewed applications (application % is %)',
                            NEW.application_id, v_app_status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: completed / cancelled / no_show rows are final.
    IF OLD.status <> 'scheduled' THEN
        RAISE EXCEPTION 'Interview % is already %; only scheduled interviews can be rescheduled, cancelled or completed',
                        OLD.interview_id, OLD.status
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'scheduled' AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
       AND NEW.scheduled_at <= now() THEN
        RAISE EXCEPTION 'Interview must be rescheduled to a future time (got %)', NEW.scheduled_at
            USING ERRCODE = 'check_violation';
    END IF;
    -- New in 021: an outcome can only be recorded once the interview time has come.
    IF NEW.status IN ('completed', 'no_show') THEN
        IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
            RAISE EXCEPTION 'Interview % cannot be rescheduled and marked % in the same change', OLD.interview_id, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        IF OLD.scheduled_at > now() THEN
            RAISE EXCEPTION 'Interview % cannot be marked % before its scheduled time (%)',
                            OLD.interview_id, NEW.status, OLD.scheduled_at
                USING ERRCODE = 'check_violation',
                      HINT = 'Wait until the interview has taken place, or reschedule or cancel it.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
