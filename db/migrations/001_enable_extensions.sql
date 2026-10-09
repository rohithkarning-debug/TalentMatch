-- 001: Enable pgvector before any vector(384) column or HNSW index is created.
-- The Docker init script also does this, but migrations must not depend on it
-- (e.g. a teammate's database created a different way).
CREATE EXTENSION IF NOT EXISTS vector;
