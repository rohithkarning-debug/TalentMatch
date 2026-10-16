-- 020: Rejecting an application withdraws its pending offer (Stage 9)
--
-- Bug flagged in Stage 7: the recruiter could choose "rejected" in the status
-- dropdown for an 'offered' application (offered -> rejected is an allowed
-- transition). The application became rejected, but its offer stayed
-- 'pending', so the candidate still saw an offer they could accept.
--
-- The fix is a trigger, not code in one API route, so it holds for EVERY way
-- the status can change: the status PATCH route, update_application_status()
-- called from psql, or a plain UPDATE. It runs inside the same transaction as
-- the status change: if anything fails, both are rolled back together.
--
-- Only a PENDING offer is touched. An accepted or declined offer is a record
-- of what the candidate decided and stays as it is (019 freezes those rows
-- anyway). withdrawOffer() in src/lib/offers.js withdraws the offer BEFORE it
-- rejects the application, so this trigger then finds nothing pending and
-- does not notify the candidate a second time.

CREATE OR REPLACE FUNCTION withdraw_pending_offer_on_reject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_title VARCHAR;
    v_company   VARCHAR;
BEGIN
    UPDATE offers SET status = 'withdrawn'
     WHERE application_id = NEW.application_id AND status = 'pending';

    IF FOUND THEN
        SELECT j.title, c.name INTO v_job_title, v_company
          FROM jobs j JOIN companies c ON c.company_id = j.company_id
         WHERE j.job_id = NEW.job_id;
        INSERT INTO notifications (user_id, type, title, message, related_application_id)
        VALUES (NEW.candidate_id, 'offer_withdrawn',
                left('Offer withdrawn: ' || v_job_title, 150),
                v_company || ' has withdrawn its offer for ' || v_job_title || '.',
                NEW.application_id);
    END IF;
    RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$$;

COMMENT ON FUNCTION withdraw_pending_offer_on_reject() IS
    'Trigger: when an application becomes rejected, its pending offer becomes withdrawn and the candidate is notified.';

DROP TRIGGER IF EXISTS trg_applications_withdraw_offer ON applications;
CREATE TRIGGER trg_applications_withdraw_offer
    AFTER UPDATE OF status ON applications
    FOR EACH ROW
    WHEN (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected')
    EXECUTE FUNCTION withdraw_pending_offer_on_reject();
