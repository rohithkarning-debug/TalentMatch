-- 018: Database rules for interviews, offers and their notifications (Stage 7)
--
--   (a) notifications.type: three new event types (ALTER a CHECK constraint)
--   (b) interviews: video/onsite interviews need a meeting link or a location
--   (c) local_today(): "today" in India, used for offer dates
--   (d) trg_interviews_guard: future time, only scheduled interviews change,
--       only shortlisted/interviewed applications get interviews
--   (e) trg_offers_guard: valid dates on insert, pending is the only state
--       that can change, an expired offer cannot be accepted or declined
--   (f) deferred constraint triggers: an application can only be
--       'interviewed' if it has an interview and 'offered' if it has a
--       pending offer, checked at COMMIT
--
-- Like migration 011, the seed's historical import (talentmatch.import_mode
-- = 'on') may insert past interviews and old offers. Updates are never
-- exempt.

-- ---------------------------------------------------------------------------
-- (a) New notification types. A CHECK constraint cannot be edited in place,
--     so it is dropped and re-created with the longer list. Existing rows are
--     re-validated when the new constraint is added.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN
        ('application_submitted', 'status_changed', 'interview_scheduled', 'offer_made', 'system',
         'interview_updated', 'offer_responded', 'offer_withdrawn'));

-- ---------------------------------------------------------------------------
-- (b) Where the interview happens. Phone interviews may leave it empty (the
--     candidate's phone number is on their profile).
-- ---------------------------------------------------------------------------
ALTER TABLE interviews DROP CONSTRAINT IF EXISTS interviews_location_required_check;
ALTER TABLE interviews
    ADD CONSTRAINT interviews_location_required_check CHECK (
        mode = 'phone' OR (location_or_link IS NOT NULL AND btrim(location_or_link) <> ''));

-- ---------------------------------------------------------------------------
-- (c) The database runs in UTC, but offer dates are Indian calendar dates.
--     Between 00:00 and 05:30 IST, current_date (UTC) is still "yesterday",
--     so an offer expiring today would look valid for 5.5 extra hours.
--     STABLE: the result is fixed within one statement (now() is too).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION local_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
    SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date;
$$;

COMMENT ON FUNCTION local_today() IS 'Today''s date in India (Asia/Kolkata), used for offer joining and expiry dates.';

-- ---------------------------------------------------------------------------
-- (d) Interview guard — BEFORE INSERT OR UPDATE
--
--   scheduled ──► completed | cancelled | no_show     (all three are final)
--
-- A CHECK constraint cannot say "scheduled_at > now()": CHECKs must give the
-- same answer forever (they are re-checked on restore), and now() keeps
-- moving. A trigger checks it only at the moment of INSERT / reschedule.
-- ---------------------------------------------------------------------------
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

    -- UPDATE
    IF OLD.status <> 'scheduled'
       AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at) THEN
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

DROP TRIGGER IF EXISTS trg_interviews_guard ON interviews;
CREATE TRIGGER trg_interviews_guard
    BEFORE INSERT OR UPDATE ON interviews
    FOR EACH ROW EXECUTE FUNCTION guard_interview_change();

-- ---------------------------------------------------------------------------
-- (e) Offer guard — BEFORE INSERT OR UPDATE
--
--   pending ──► accepted | declined   (candidate, only until expires_on)
--      └──────► withdrawn             (recruiter)
--
-- An offer is valid until the END of its expiry day (expires_on >= today).
-- Changing expires_on is allowed (an extension, or a test simulating time
-- passing); the existing CHECK still keeps it on or before joining_date.
-- ---------------------------------------------------------------------------
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

    -- UPDATE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;
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

DROP TRIGGER IF EXISTS trg_offers_guard ON offers;
CREATE TRIGGER trg_offers_guard
    BEFORE INSERT OR UPDATE ON offers
    FOR EACH ROW EXECUTE FUNCTION guard_offer_change();

-- ---------------------------------------------------------------------------
-- (f) "interviewed" needs an interview, "offered" needs a pending offer.
--
-- DEFERRABLE INITIALLY DEFERRED: the check runs at COMMIT, not right after
-- the UPDATE. Inside one transaction the order of the steps is then free
-- (status first, offer second), and only the final state must be consistent.
-- A recruiter setting 'offered' through the status dropdown without making
-- an offer fails at COMMIT and nothing is saved.
--
-- The row may have changed again later in the transaction (e.g. offered and
-- then rejected), so the function re-reads the current status instead of
-- trusting NEW.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_application_stage_records()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM applications WHERE application_id = NEW.application_id;
    IF v_status = 'interviewed' AND NOT EXISTS (
           SELECT 1 FROM interviews WHERE application_id = NEW.application_id) THEN
        RAISE EXCEPTION 'Application % cannot be interviewed without an interview; schedule one instead',
                        NEW.application_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_status = 'offered' AND NOT EXISTS (
           SELECT 1 FROM offers WHERE application_id = NEW.application_id AND status = 'pending') THEN
        RAISE EXCEPTION 'Application % cannot be offered without a pending offer; make an offer instead',
                        NEW.application_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_stage_records ON applications;
CREATE CONSTRAINT TRIGGER trg_applications_stage_records
    AFTER UPDATE OF status ON applications
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (NEW.status IN ('interviewed', 'offered') AND NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION check_application_stage_records();
