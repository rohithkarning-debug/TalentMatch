-- 017: Filling in a match score is not "updating the application".
--
-- applications.match_score is derived data: the cosine similarity of the
-- resume and job embeddings. When `npm run db:embed` fills in scores that were
-- NULL because the embeddings did not exist yet, the trigger from migration
-- 010 would also refresh applications.updated_at, and updated_at would stop
-- meaning "last status change". Same fix as migration 014: re-create the
-- trigger with 'match_score' as an ignored column.

DROP TRIGGER IF EXISTS trg_applications_set_updated_at ON applications;
CREATE TRIGGER trg_applications_set_updated_at
    BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at('match_score');
