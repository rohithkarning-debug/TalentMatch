-- 014: Logging in is not "editing the user".
--
-- Stage 3 login sets users.last_login_at. With the trigger from migration 010,
-- that would also refresh users.updated_at on every login, so updated_at
-- would stop meaning "profile last edited". Migration 010 is already applied
-- and must not be edited, so this migration re-creates the users trigger with
-- 'last_login_at' as an ignored column, the same mechanism jobs uses for
-- applicant_count.

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at('last_login_at');
