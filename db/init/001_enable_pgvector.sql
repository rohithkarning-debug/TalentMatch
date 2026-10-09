-- Runs automatically the first time the Docker volume is created.
-- Enables pgvector so the same PostgreSQL database can store embeddings.
CREATE EXTENSION IF NOT EXISTS vector;
