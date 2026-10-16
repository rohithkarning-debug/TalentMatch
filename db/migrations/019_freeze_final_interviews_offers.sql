-- 019: Final interviews and offers are frozen (fix for migration 018)
--
-- Bug found by tests/integration/pipeline.test.js: the 018 guards only
-- rejected a CHANGE of status. Setting the same final status again
-- (withdrawn -> withdrawn, cancelled -> cancelled, accepted -> accepted)
-- passed, so withdrawing an offer twice returned 200 and sent the candidate
-- a second notification.
--
-- A row trigger cannot tell "SET status = 'withdrawn'" apart from any other
-- UPDATE of the row, so the rule is now simpler and stricter: once an
-- interview is completed / cancelled / no_show, or an offer is accepted /
-- declined / withdrawn, NO update of that row is allowed. Nothing in the
-- application needs to edit a final row.
--
-- Only the UPDATE branches change; the INSERT rules are the same as in 018.
-- (018 is already applied and must not be edited, so the functions are
-- replaced here.)

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
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_offer_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_app_status VARCHAR;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF coalesce(current_setting('talentmatch.import_mode', true), '') = 'on' THEN
            RETURN NEW;  -- seed imports an offer made in the past
        END IF;
        IF NEW.status <> 'pending' OR NEW.responded_at IS NOT NULL THEN
            RAISE EXCEPTION 'A new offer must start as pending (got %)', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.joining_date <= local_today() THEN
            RAISE EXCEPTION 'Joining date must be after today (got %)', NEW.joining_date
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.expires_on IS NOT NULL AND NEW.expires_on < local_today() THEN
            RAISE EXCEPTION 'Offer expiry date cannot be in the past (got %)', NEW.expires_on
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: accepted / declined / withdrawn rows are final.
    IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'Offer % is already %; only a pending offer can be accepted, declined or withdrawn',
                        OLD.offer_id, OLD.status
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('accepted', 'declined') THEN
        IF OLD.expires_on IS NOT NULL AND OLD.expires_on < local_today() THEN
            RAISE EXCEPTION 'Offer % expired on %; it can no longer be %', OLD.offer_id, OLD.expires_on, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT status INTO v_app_status FROM applications WHERE application_id = NEW.application_id;
        IF v_app_status <> 'offered' THEN
            RAISE EXCEPTION 'Offer % cannot be %: the application is %', OLD.offer_id, NEW.status, v_app_status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
