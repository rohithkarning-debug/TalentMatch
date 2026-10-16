-- 016: compute_match_score(resume_id, job_id)
--
-- In plain words: "How close in meaning is THIS resume to THIS job?"
--     score = 1 - (resume_vector <=> job_vector)
-- <=> is pgvector's cosine DISTANCE, so the score is the cosine similarity of
-- the two stored MiniLM vectors (1 = same meaning, 0 = unrelated). Same
-- formula as rank_candidates_for_job() (migration 015), but for one specific
-- resume instead of the candidate's primary one: an application is scored
-- with the resume the candidate actually chose when applying.
--
-- Returns NULL when either side has no embedding yet (no row in
-- resume_embeddings / job_embeddings). NULL means "not computed", never a
-- guessed value; applications.match_score stays NULL in that case.
--
-- Rounded to 4 decimals to match applications.match_score NUMERIC(5,4).
-- STABLE: reads tables but does not change them, so it is safe inside
-- INSERT ... VALUES (..., compute_match_score($3, $1)).
CREATE OR REPLACE FUNCTION compute_match_score(p_resume_id BIGINT, p_job_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT round((1 - (re.embedding <=> je.embedding))::numeric, 4)
      FROM resume_embeddings re
      CROSS JOIN job_embeddings je
     WHERE re.resume_id = p_resume_id
       AND je.job_id    = p_job_id;
$$;

COMMENT ON FUNCTION compute_match_score(BIGINT, BIGINT) IS
    'Cosine similarity 1 - (resume <=> job) between one resume embedding and one job embedding, rounded to 4 decimals; NULL if either is not embedded.';
