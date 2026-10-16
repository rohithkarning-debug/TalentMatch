-- 022: An application whose offer was accepted cannot be rejected (Stage 9)
--
-- offered -> rejected is an allowed transition (011), so after a candidate
-- ACCEPTED an offer the recruiter could still choose "rejected". The
-- application then said rejected while the offer said accepted: two records
-- contradicting each other about the same hire. The accepted offer is final
-- (019 freezes it), so the application must not move away from it either.
--
-- A BEFORE trigger refuses the change before the row is written, so the
-- history trigger, the 020 withdrawal trigger and the notification in
-- update_application_status() never run. Like every guard it raises
-- check_violation with a readable message, which the API turns into 409
-- RULE_VIOLATION (src/lib/api/db-rules.js).
--
-- A pending offer is still fine (020 withdraws it), and so is a declined
-- offer (the recruiter closes the application after the candidate said no).

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
                        NEW.application_id, to_char(v_responded_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
            USING ERRCODE = 'check_violation',
                  HINT = 'An accepted offer is final, so the application stays offered.';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_reject_after_accepted_offer() IS
    'Trigger: refuses rejecting an application whose offer was accepted.';

DROP TRIGGER IF EXISTS trg_applications_accepted_offer_guard ON applications;
CREATE TRIGGER trg_applications_accepted_offer_guard
    BEFORE UPDATE OF status ON applications
    FOR EACH ROW
    WHEN (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected')
    EXECUTE FUNCTION guard_reject_after_accepted_offer();
