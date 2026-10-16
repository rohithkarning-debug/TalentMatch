-- 015: Semantic candidate ranking with pgvector (deferred from 012 until real
-- embeddings existed).
--
-- rank_candidates_for_job(job_id, limit, applicants_only)
--
-- In plain words: "Which candidates' PRIMARY resumes are closest in meaning to
-- this job posting?" Closeness is cosine similarity between the job's
-- embedding and each resume's embedding (both from all-MiniLM-L6-v2):
--     similarity = 1 - (resume_vector <=> job_vector)
-- where <=> is pgvector's cosine DISTANCE operator. 1 = same direction
-- (same meaning), 0 = unrelated.
--
-- Next to the semantic score it returns an explainable skills count: how many
-- of the job's REQUIRED skills the candidate lists at or above the required
-- proficiency (same rule as query 8 in db/queries/important_queries.sql).
--
-- p_applicants_only = TRUE  -> only candidates who applied to this job
--                             (recruiter screening an applicant pool)
-- p_applicants_only = FALSE -> every candidate with an embedded primary resume
--                             (recruiter sourcing people who have not applied)
CREATE OR REPLACE FUNCTION rank_candidates_for_job(
    p_job_id          BIGINT,
    p_limit           INTEGER DEFAULT 10,
    p_applicants_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    candidate_id      BIGINT,
    full_name         VARCHAR,
    years_experience  NUMERIC,
    resume_id         BIGINT,
    similarity        NUMERIC,
    matched_skills    INTEGER,
    required_skills   INTEGER,
    has_applied       BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
DECLARE
    v_job_vector vector(384);
    v_required   INTEGER;
BEGIN
    -- 1. Validate inputs
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Limit must be between 1 and 100 (got %)', coalesce(p_limit::text, 'NULL')
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jobs WHERE job_id = p_job_id) THEN
        RAISE EXCEPTION 'Job % does not exist', p_job_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- 2. The job's vector. Read once into a variable so the main query
    --    compares every resume against a constant (lets the HNSW index be used).
    SELECT je.embedding INTO v_job_vector FROM job_embeddings je WHERE je.job_id = p_job_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % has no embedding yet', p_job_id
            USING ERRCODE = 'no_data_found', HINT = 'Run npm run db:embed';
    END IF;

    SELECT count(*)::int INTO v_required
      FROM job_skills js WHERE js.job_id = p_job_id AND js.is_required;

    -- 3. Nearest primary resumes first, then attach profile + skill counts.
    RETURN QUERY
    WITH nearest AS (
        SELECT r.candidate_id, r.resume_id,
               re.embedding <=> v_job_vector AS distance
          FROM resume_embeddings re
          JOIN resumes r ON r.resume_id = re.resume_id
          JOIN users   u ON u.user_id   = r.candidate_id
         WHERE r.is_primary
           AND u.is_active
           AND (NOT p_applicants_only OR EXISTS (
                    SELECT 1 FROM applications a
                     WHERE a.job_id = p_job_id AND a.candidate_id = r.candidate_id))
         ORDER BY re.embedding <=> v_job_vector
         LIMIT p_limit
    )
    SELECT n.candidate_id,
           u.full_name,
           c.years_experience,
           n.resume_id,
           -- 4 decimals: same precision as applications.match_score NUMERIC(5,4).
           round((1 - n.distance)::numeric, 4),
           (SELECT count(*)::int
              FROM job_skills js
              JOIN candidate_skills cs
                ON cs.skill_id = js.skill_id AND cs.candidate_id = n.candidate_id
             WHERE js.job_id = p_job_id
               AND js.is_required
               AND cs.proficiency >= js.min_proficiency),
           v_required,
           EXISTS (SELECT 1 FROM applications a
                    WHERE a.job_id = p_job_id AND a.candidate_id = n.candidate_id)
      FROM nearest n
      JOIN candidates c ON c.user_id = n.candidate_id
      JOIN users      u ON u.user_id = n.candidate_id
     -- Order by the unrounded distance so near-ties keep their true order.
     ORDER BY n.distance, n.candidate_id;
END;
$$;

COMMENT ON FUNCTION rank_candidates_for_job(BIGINT, INTEGER, BOOLEAN) IS
    'Ranks candidates by cosine similarity (1 - <=>) between their primary resume embedding and the job embedding; optional applicants-only filter; includes required-skill match counts.';
