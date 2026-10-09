-- ============================================================================
-- WARNING: DESTRUCTIVE. Drops every TalentMatch table and ALL data in it.
-- Only for the local development database. Run it through `npm run db:reset`,
-- which checks the target database before executing this file.
-- ============================================================================
-- Tables are dropped children-first (reverse dependency order). CASCADE also
-- removes dependent objects such as indexes, constraints and (from Stage 2)
-- views and triggers. The pgvector extension itself is kept.

DROP TABLE IF EXISTS job_embeddings             CASCADE;
DROP TABLE IF EXISTS resume_embeddings          CASCADE;
DROP TABLE IF EXISTS notifications              CASCADE;
DROP TABLE IF EXISTS offers                     CASCADE;
DROP TABLE IF EXISTS interviews                 CASCADE;
DROP TABLE IF EXISTS application_status_history CASCADE;
DROP TABLE IF EXISTS applications               CASCADE;
DROP TABLE IF EXISTS resumes                    CASCADE;
DROP TABLE IF EXISTS job_skills                 CASCADE;
DROP TABLE IF EXISTS jobs                       CASCADE;
DROP TABLE IF EXISTS candidate_skills           CASCADE;
DROP TABLE IF EXISTS skills                     CASCADE;
DROP TABLE IF EXISTS candidates                 CASCADE;
DROP TABLE IF EXISTS recruiters                 CASCADE;
DROP TABLE IF EXISTS companies                  CASCADE;
DROP TABLE IF EXISTS users                      CASCADE;

-- Forget applied migrations so `npm run db:migrate` rebuilds everything.
DROP TABLE  IF EXISTS tm_meta.schema_migrations;
DROP SCHEMA IF EXISTS tm_meta;
