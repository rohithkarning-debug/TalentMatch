-- 023: No offer while an interview is still scheduled (Stage 10)
--
-- Bug found in the Stage 10 walkthrough: an application with round 2 still
-- 'scheduled' could get an offer, and the candidate could accept it. The
-- interview then stayed 'scheduled' next to an accepted offer: the records
-- claimed a pending interview for a finished hire.
--
-- A BEFORE INSERT trigger on offers refuses the new offer while any interview
-- of the same application is 'scheduled'. The recruiter first completes the
-- interview (possible once its time has passed, migration 021) or cancels it.
-- Like every guard it raises check_violation with a readable message, which
-- the API turns into 409 RULE_VIOLATION (src/lib/api/db-rules.js).
--
-- Unlike trg_offers_guard, the seed's historical import is NOT exempt: the
-- seed must tell a consistent story too.
--
-- The reverse case needs no new rule: once an offer is made the application
-- is 'offered', and trg_interviews_guard only schedules interviews for
-- shortlisted or interviewed applications.

CREATE OR REPLACE FUNCTION guard_offer_while_interview_scheduled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_round        SMALLINT;
    v_scheduled_at TIMESTAMPTZ;
BEGIN
    SELECT round_no, scheduled_at INTO v_round, v_scheduled_at
      FROM interviews
     WHERE application_id = NEW.application_id AND status = 'scheduled'
     ORDER BY scheduled_at
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Complete or cancel the scheduled interview before making an offer.'
            USING ERRCODE = 'check_violation',
                  HINT = format('Application %s has interview round %s scheduled for %s IST.',
                                NEW.application_id, v_round,
                                to_char(v_scheduled_at AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY, FMHH12:MI am'));
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_offer_while_interview_scheduled() IS
    'Trigger: refuses a new offer while the application still has a scheduled interview.';

DROP TRIGGER IF EXISTS trg_offers_interview_guard ON offers;
CREATE TRIGGER trg_offers_interview_guard
    BEFORE INSERT ON offers
    FOR EACH ROW EXECUTE FUNCTION guard_offer_while_interview_scheduled();
