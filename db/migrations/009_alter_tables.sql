-- 009: Schema evolution with ALTER TABLE.
-- Real projects change after the first release. Instead of editing the old
-- CREATE TABLE migrations (which have already run), we ALTER the live tables.

-- 1. New column with a default and an inline CHECK constraint.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time'
        CONSTRAINT jobs_employment_type_check
        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship'));

-- 2. Minimum experience required by a job, validated against a sensible range.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS min_experience_years NUMERIC(4,1) NOT NULL DEFAULT 0;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_min_experience_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_min_experience_check CHECK (min_experience_years BETWEEN 0 AND 40);

-- 3. Track the last successful login (filled in by the auth module later).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 4. Change an existing column: allow longer company industry labels.
ALTER TABLE companies ALTER COLUMN industry TYPE VARCHAR(120);

-- 5. Add a named constraint after the fact: a closing date cannot be before
--    the posting date.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_closes_after_posted_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_closes_after_posted_check
    CHECK (closes_at IS NULL OR closes_at >= (posted_at AT TIME ZONE 'UTC')::date);
