-- ============================================================================
-- WARNING: DESTRUCTIVE. Drops every TalentMatch table and ALL data in it.
-- Only for the local development database. Run it through `npm run db:reset`,
-- which checks the target database before executing this file.
-- ============================================================================
-- Views first, then tables children-first (reverse dependency order). CASCADE
-- also removes indexes, constraints and triggers. Functions are not owned by
-- tables, so they are dropped explicitly at the end. The pgvector extension
-- itself is kept.

DROP VIEW IF EXISTS company_hiring_summary;
DROP VIEW IF EXISTS candidate_application_view;
DROP VIEW IF EXISTS recruiter_pipeline_view;

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

-- Stored and trigger functions (migrations 010–012, 015, 016, 018–020, 022, 023)
DROP FUNCTION IF EXISTS guard_offer_while_interview_scheduled();
DROP FUNCTION IF EXISTS guard_reject_after_accepted_offer();
DROP FUNCTION IF EXISTS withdraw_pending_offer_on_reject();
DROP FUNCTION IF EXISTS check_application_stage_records();
DROP FUNCTION IF EXISTS guard_offer_change();
DROP FUNCTION IF EXISTS guard_interview_change();
DROP FUNCTION IF EXISTS local_today();
DROP FUNCTION IF EXISTS compute_match_score(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS rank_candidates_for_job(BIGINT, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS update_application_status(BIGINT, VARCHAR, BIGINT, TEXT);
DROP FUNCTION IF EXISTS generate_hiring_pipeline_report(BIGINT, DATE, DATE);
DROP FUNCTION IF EXISTS guard_application_initial_status();
DROP FUNCTION IF EXISTS log_application_status_change();
DROP FUNCTION IF EXISTS guard_application_status_transition();
DROP FUNCTION IF EXISTS reset_applicant_counts_on_truncate();
DROP FUNCTION IF EXISTS maintain_applicant_count();
DROP FUNCTION IF EXISTS is_valid_status_transition(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS set_updated_at();

-- Forget applied migrations so `npm run db:migrate` rebuilds everything.
DROP TABLE  IF EXISTS tm_meta.schema_migrations;
DROP SCHEMA IF EXISTS tm_meta;
