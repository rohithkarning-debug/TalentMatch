-- 008: B-tree indexes on foreign keys and frequently filtered columns.
-- PostgreSQL indexes primary keys and UNIQUE constraints automatically, but NOT
-- foreign-key columns. Without these, joins and ON DELETE checks scan the table.
-- (FKs that are already the leading column of a PK/UNIQUE index are skipped:
--  candidate_skills.candidate_id, job_skills.job_id, applications.job_id,
--  interviews.application_id, offers.application_id.)

CREATE INDEX IF NOT EXISTS recruiters_company_id_idx       ON recruiters (company_id);
CREATE INDEX IF NOT EXISTS candidate_skills_skill_id_idx   ON candidate_skills (skill_id);
CREATE INDEX IF NOT EXISTS jobs_company_id_idx             ON jobs (company_id);
CREATE INDEX IF NOT EXISTS jobs_recruiter_id_idx           ON jobs (recruiter_id);
CREATE INDEX IF NOT EXISTS job_skills_skill_id_idx         ON job_skills (skill_id);
CREATE INDEX IF NOT EXISTS resumes_candidate_id_idx        ON resumes (candidate_id);
CREATE INDEX IF NOT EXISTS applications_candidate_id_idx   ON applications (candidate_id);
CREATE INDEX IF NOT EXISTS applications_resume_id_idx      ON applications (resume_id);
CREATE INDEX IF NOT EXISTS ash_application_id_idx          ON application_status_history (application_id, changed_at);
CREATE INDEX IF NOT EXISTS ash_changed_by_idx              ON application_status_history (changed_by);
CREATE INDEX IF NOT EXISTS interviews_interviewer_id_idx   ON interviews (interviewer_id);
CREATE INDEX IF NOT EXISTS notifications_application_idx   ON notifications (related_application_id);

-- Frequently queried columns
CREATE INDEX IF NOT EXISTS users_role_idx                  ON users (role);
CREATE INDEX IF NOT EXISTS applications_job_status_idx     ON applications (job_id, status);
CREATE INDEX IF NOT EXISTS interviews_scheduled_at_idx     ON interviews (scheduled_at);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx  ON notifications (user_id, created_at DESC);

-- Partial indexes: only index the rows that hot queries actually touch.
-- Candidates browse OPEN jobs, newest first; closed/draft jobs are excluded,
-- keeping the index small.
CREATE INDEX IF NOT EXISTS jobs_open_posted_at_idx
    ON jobs (posted_at DESC) WHERE status = 'open';

-- The notification bell only counts UNREAD notifications.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
    ON notifications (user_id) WHERE NOT is_read;
