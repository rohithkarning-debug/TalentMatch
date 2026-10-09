-- 010: Automatically maintained updated_at columns.
--
-- Before this migration only `applications` had an updated_at column, and the
-- application code would have had to remember to set it. A BEFORE UPDATE
-- trigger now sets it inside the database, so it can never be forgotten.

-- 1. Add updated_at to the tables whose rows are edited after creation.
--    (Existing rows get now(), i.e. the time this migration ran.)
ALTER TABLE users      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE companies  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE recruiters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE jobs       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE offers     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. One generic trigger function for all of them.
--    * It only touches updated_at when some *other* column really changed, so a
--      no-op UPDATE (same values) does not look like an edit.
--    * Trigger arguments (TG_ARGV) list extra columns to ignore. jobs passes
--      'applicant_count' so that a new application (which bumps the counter
--      through another trigger) does not count as "the job was edited".
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    ignored text[] := coalesce(TG_ARGV::text[], '{}') || ARRAY['updated_at'];
BEGIN
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
    'BEFORE UPDATE trigger: sets NEW.updated_at = now() when any column other than updated_at (and the columns passed as trigger arguments) changed.';

-- 3. Attach it. DROP ... IF EXISTS first so the file can never create a
--    duplicate trigger.
DROP TRIGGER IF EXISTS trg_users_set_updated_at        ON users;
DROP TRIGGER IF EXISTS trg_companies_set_updated_at    ON companies;
DROP TRIGGER IF EXISTS trg_recruiters_set_updated_at   ON recruiters;
DROP TRIGGER IF EXISTS trg_candidates_set_updated_at   ON candidates;
DROP TRIGGER IF EXISTS trg_jobs_set_updated_at         ON jobs;
DROP TRIGGER IF EXISTS trg_applications_set_updated_at ON applications;
DROP TRIGGER IF EXISTS trg_interviews_set_updated_at   ON interviews;
DROP TRIGGER IF EXISTS trg_offers_set_updated_at       ON offers;

CREATE TRIGGER trg_users_set_updated_at        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_companies_set_updated_at    BEFORE UPDATE ON companies    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_recruiters_set_updated_at   BEFORE UPDATE ON recruiters   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_candidates_set_updated_at   BEFORE UPDATE ON candidates   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_jobs_set_updated_at         BEFORE UPDATE ON jobs         FOR EACH ROW EXECUTE FUNCTION set_updated_at('applicant_count');
CREATE TRIGGER trg_applications_set_updated_at BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_interviews_set_updated_at   BEFORE UPDATE ON interviews   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_offers_set_updated_at       BEFORE UPDATE ON offers       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
