-- 024: Dates in rule messages use the app's display format (Stage 10)
--
-- The UI shows every date as "16 Oct 2026" (src/lib/format-date.js). Some
-- trigger messages reach the UI unchanged as 409 errors and still printed
-- dates as 2026-10-16. Only the message texts change here; the rules are
-- exactly those of 019 (guard_offer_change) and 022
-- (guard_reject_after_accepted_offer). Migrations already applied are never
-- edited, so both functions are replaced whole.

CREATE OR REPLACE FUNCTION guard_reject_after_accepted_offer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_responded_at TIMESTAMPTZ;
BEGIN
    SELECT responded_at INTO v_responded_at
      FROM offers
     WHERE application_id = NEW.application_id AND status = 'accepted';
    IF FOUND THEN
        RAISE EXCEPTION 'Application % cannot be rejected: the candidate accepted its offer on %',
                        NEW.application_id, to_char(v_responded_at AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY')
            USING ERRCODE = 'check_violation',
                  HINT = 'An accepted offer is final, so the application stays offered.';
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
            RAISE EXCEPTION 'Joining date must be after today (got %)', to_char(NEW.joining_date, 'FMDD Mon YYYY')
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.expires_on IS NOT NULL AND NEW.expires_on < local_today() THEN
            RAISE EXCEPTION 'Offer expiry date cannot be in the past (got %)', to_char(NEW.expires_on, 'FMDD Mon YYYY')
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
            RAISE EXCEPTION 'Offer % expired on %; it can no longer be %', OLD.offer_id, to_char(OLD.expires_on, 'FMDD Mon YYYY'), NEW.status
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
