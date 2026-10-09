-- 007: Vector store (pgvector) — embeddings live in the same database as the
-- relational data, linked one-to-one to resumes and jobs by foreign keys.
--
-- Model: sentence-transformers/all-MiniLM-L6-v2 → 384-dimensional vectors.
-- Long text is chunked, each chunk embedded, and the L2-normalised MEAN vector
-- stored here. Because vectors are unit length, cosine distance (<=>) is the
-- natural metric: similarity = 1 - (a <=> b).

CREATE TABLE IF NOT EXISTS resume_embeddings (
    resume_id    BIGINT       NOT NULL,
    embedding    vector(384)  NOT NULL,
    model_name   VARCHAR(100) NOT NULL DEFAULT 'sentence-transformers/all-MiniLM-L6-v2',
    chunk_count  SMALLINT     NOT NULL,
    -- SHA-256 of the text that was embedded; lets us detect stale embeddings.
    source_hash  CHAR(64)     NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT resume_embeddings_pkey PRIMARY KEY (resume_id),
    CONSTRAINT resume_embeddings_chunk_count_check CHECK (chunk_count >= 1),
    CONSTRAINT resume_embeddings_source_hash_check CHECK (source_hash ~ '^[0-9a-f]{64}$'),
    -- Stored vectors must be normalised (length ≈ 1).
    CONSTRAINT resume_embeddings_normalized_check CHECK (abs(vector_norm(embedding) - 1) < 0.001),
    CONSTRAINT resume_embeddings_resume_fkey FOREIGN KEY (resume_id)
        REFERENCES resumes (resume_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_embeddings (
    job_id       BIGINT       NOT NULL,
    embedding    vector(384)  NOT NULL,
    model_name   VARCHAR(100) NOT NULL DEFAULT 'sentence-transformers/all-MiniLM-L6-v2',
    chunk_count  SMALLINT     NOT NULL,
    source_hash  CHAR(64)     NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT job_embeddings_pkey PRIMARY KEY (job_id),
    CONSTRAINT job_embeddings_chunk_count_check CHECK (chunk_count >= 1),
    CONSTRAINT job_embeddings_source_hash_check CHECK (source_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT job_embeddings_normalized_check CHECK (abs(vector_norm(embedding) - 1) < 0.001),
    CONSTRAINT job_embeddings_job_fkey FOREIGN KEY (job_id)
        REFERENCES jobs (job_id) ON DELETE CASCADE
);

-- HNSW = approximate nearest-neighbour graph index. vector_cosine_ops makes
-- it serve ORDER BY embedding <=> $1 (cosine distance) queries.
CREATE INDEX IF NOT EXISTS resume_embeddings_embedding_hnsw_idx
    ON resume_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS job_embeddings_embedding_hnsw_idx
    ON job_embeddings USING hnsw (embedding vector_cosine_ops);
