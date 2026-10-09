-- 012: Stored functions
--   generate_hiring_pipeline_report(company_id, from_date, to_date)
--   update_application_status(application_id, new_status, changed_by, note)
--
-- rank_candidates_for_job() is NOT created here. It needs real embeddings and
-- is implemented in the embeddings stage (Stage 5). No fake ranking.

-- ---------------------------------------------------------------------------
-- generate_hiring_pipeline_report
-- ---------------------------------------------------------------------------
-- In plain words: "For every job (optionally only one company, optionally
-- only applications received in a date range), how many people are at each
-- stage, what fraction got shortlisted / offered, how fast did we shortlist,
-- and how many interviews and accepted offers came out of it?"
--
-- Every job is listed, even with zero applications (LEFT JOIN), so recruiters
-- can see postings that attract nobody.
--
-- Rates are percentages of applications that EVER reached the stage, taken
-- from application_status_history. A candidate who was shortlisted and later
-- rejected still counts as "shortlisted" for the shortlist rate.
CREATE OR REPLACE FUNCTION generate_hiring_pipeline_report(
    p_company_id BIGINT DEFAULT NULL,
    p_from       DATE   DEFAULT NULL,
    p_to         DATE   DEFAULT NULL
)
RETURNS TABLE (
    company_name           VARCHAR,
    job_id                 BIGINT,
    job_title              VARCHAR,
    job_status             VARCHAR,
    total_applications     BIGINT,
    applied                BIGINT,
    shortlisted            BIGINT,
    interviewed            BIGINT,
    offered                BIGINT,
    rejected               BIGINT,
    shortlist_rate_pct     NUMERIC,
    offer_rate_pct         NUMERIC,
    avg_days_to_shortlist  NUMERIC,
    interviews_completed   BIGINT,
    offers_accepted        BIGINT,
    avg_match_score        NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
BEGIN
    -- Input validation
    IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
        RAISE EXCEPTION 'Invalid date range: from (%) is after to (%)', p_from, p_to
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_company_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM companies WHERE company_id = p_company_id) THEN
        RAISE EXCEPTION 'Company % does not exist', p_company_id
            USING ERRCODE = 'no_data_found';
    END IF;

    RETURN QUERY
    WITH app AS (
        -- Applications in the requested period, with "when did it first reach
        -- shortlisted / offered" looked up from the audit history.
        SELECT a.application_id, a.job_id, a.status, a.applied_at, a.match_score,
               (SELECT min(h.changed_at) FROM application_status_history h
                 WHERE h.application_id = a.application_id
                   AND h.new_status = 'shortlisted')          AS shortlisted_at,
               EXISTS (SELECT 1 FROM application_status_history h
                        WHERE h.application_id = a.application_id
                          AND h.new_status = 'offered')         AS reached_offer
        FROM applications a
        WHERE (p_from IS NULL OR a.applied_at >= p_from)
          AND (p_to   IS NULL OR a.applied_at <  p_to + 1)      -- inclusive end date
    )
    SELECT c.name,
           j.job_id,
           j.title,
           j.status,
           count(app.application_id),
           count(*) FILTER (WHERE app.status = 'applied'),
           count(*) FILTER (WHERE app.status = 'shortlisted'),
           count(*) FILTER (WHERE app.status = 'interviewed'),
           count(*) FILTER (WHERE app.status = 'offered'),
           count(*) FILTER (WHERE app.status = 'rejected'),
           round(100.0 * count(app.shortlisted_at) / nullif(count(app.application_id), 0), 1),
           round(100.0 * count(*) FILTER (WHERE app.reached_offer)
                       / nullif(count(app.application_id), 0), 1),
           round(avg(extract(epoch FROM app.shortlisted_at - app.applied_at) / 86400)::numeric, 1),
           -- Correlated subqueries instead of extra JOINs: joining interviews
           -- and offers here would multiply application rows and inflate counts.
           (SELECT count(*) FROM interviews i JOIN app a2 USING (application_id)
             WHERE a2.job_id = j.job_id AND i.status = 'completed'),
           (SELECT count(*) FROM offers o JOIN app a2 USING (application_id)
             WHERE a2.job_id = j.job_id AND o.status = 'accepted'),
           round(avg(app.match_score), 4)
    FROM jobs j
    JOIN companies c ON c.company_id = j.company_id
    LEFT JOIN app    ON app.job_id   = j.job_id
    WHERE p_company_id IS NULL OR j.company_id = p_company_id
    GROUP BY c.company_id, c.name, j.job_id
    ORDER BY c.name, j.posted_at;
END;
$$;

COMMENT ON FUNCTION generate_hiring_pipeline_report(BIGINT, DATE, DATE) IS
    'Per-job hiring funnel: stage counts, shortlist/offer conversion rates, days to shortlist, completed interviews, accepted offers. Optional company and applied_at date filters.';

-- ---------------------------------------------------------------------------
-- update_application_status
-- ---------------------------------------------------------------------------
-- In plain words: "Move application X to status Y on behalf of user Z."
--
--   1. Checks the inputs (status spelled correctly, application exists).
--   2. Locks the application row (FOR UPDATE) so two recruiters clicking at
--      the same time cannot both change it.
--   3. Checks permission: admins may update any application, recruiters only
--      applications for jobs of their own company, candidates never.
--   4. Runs the UPDATE. It does NOT re-implement the workflow rules; it relies
--      on the database triggers:
--        - trg_applications_status_guard  rejects invalid transitions
--        - trg_applications_status_history writes the audit row (with who/why)
--        - trg_applications_set_updated_at refreshes updated_at
--   5. Notifies the candidate.
--
-- A function body runs atomically: if any step fails, nothing is saved, not
-- the status, the history row or the notification.
CREATE OR REPLACE FUNCTION update_application_status(
    p_application_id BIGINT,
    p_new_status     VARCHAR,
    p_changed_by     BIGINT,
    p_note           TEXT DEFAULT NULL
)
RETURNS applications
LANGUAGE plpgsql
AS $$
DECLARE
    v_app        applications;
    v_job_title  VARCHAR;
    v_company_id BIGINT;
    v_old_status VARCHAR;
    v_actor_role VARCHAR;
BEGIN
    -- 1. Validate inputs
    IF p_new_status IS NULL OR p_new_status NOT IN
       ('applied', 'shortlisted', 'interviewed', 'offered', 'rejected') THEN
        RAISE EXCEPTION 'Unknown application status: %', coalesce(p_new_status, 'NULL')
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 2. Load and lock the application
    SELECT * INTO v_app
      FROM applications
     WHERE application_id = p_application_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application % does not exist', p_application_id
            USING ERRCODE = 'no_data_found';
    END IF;
    v_old_status := v_app.status;

    SELECT title, company_id INTO v_job_title, v_company_id
      FROM jobs WHERE job_id = v_app.job_id;

    -- 3. Authorisation (defence in depth; the API checks too)
    SELECT role INTO v_actor_role FROM users WHERE user_id = p_changed_by AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % does not exist or is inactive', p_changed_by
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_actor_role = 'candidate'
       OR (v_actor_role = 'recruiter' AND NOT EXISTS (
              SELECT 1 FROM recruiters r
               WHERE r.user_id = p_changed_by AND r.company_id = v_company_id)) THEN
        RAISE EXCEPTION 'User % is not allowed to update application %', p_changed_by, p_application_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_old_status = p_new_status THEN
        RAISE NOTICE 'Application % is already %, nothing changed', p_application_id, p_new_status;
        RETURN v_app;
    END IF;

    -- 4. Pass who/why to the history trigger, then update.
    PERFORM set_config('talentmatch.actor_id', p_changed_by::text, true);
    PERFORM set_config('talentmatch.status_note', coalesce(p_note, ''), true);

    UPDATE applications
       SET status = p_new_status
     WHERE application_id = p_application_id
    RETURNING * INTO v_app;

    PERFORM set_config('talentmatch.actor_id', '', true);
    PERFORM set_config('talentmatch.status_note', '', true);

    -- 5. Notify the candidate
    INSERT INTO notifications (user_id, type, title, message, related_application_id)
    VALUES (v_app.candidate_id, 'status_changed',
            'Application update: ' || v_job_title,
            format('Your application for %s moved from %s to %s.', v_job_title, v_old_status, p_new_status),
            p_application_id);

    RETURN v_app;
END;
$$;

COMMENT ON FUNCTION update_application_status(BIGINT, VARCHAR, BIGINT, TEXT) IS
    'Validates input and permission, locks the row, updates status (triggers enforce transitions and write history), notifies the candidate. Atomic.';
