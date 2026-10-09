-- 004: Job postings and the jobs <-> skills many-to-many relationship.

CREATE TABLE IF NOT EXISTS jobs (
    job_id           BIGINT GENERATED ALWAYS AS IDENTITY,
    company_id       BIGINT        NOT NULL,
    recruiter_id     BIGINT,                       -- NULL if the posting recruiter was removed
    title            VARCHAR(150)  NOT NULL,
    description      TEXT          NOT NULL,
    location         VARCHAR(120)  NOT NULL,
    work_mode        VARCHAR(10)   NOT NULL DEFAULT 'onsite',
    salary_min       NUMERIC(12,2),
    salary_max       NUMERIC(12,2),
    currency         CHAR(3)       NOT NULL DEFAULT 'INR',
    openings         SMALLINT      NOT NULL DEFAULT 1,
    status           VARCHAR(10)   NOT NULL DEFAULT 'open',
    applicant_count  INTEGER       NOT NULL DEFAULT 0,  -- maintained by a trigger from Stage 2
    posted_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    closes_at        DATE,

    CONSTRAINT jobs_pkey PRIMARY KEY (job_id),
    CONSTRAINT jobs_title_not_blank_check CHECK (btrim(title) <> ''),
    -- Long enough to be meaningful for semantic matching.
    CONSTRAINT jobs_description_length_check CHECK (length(btrim(description)) >= 50),
    CONSTRAINT jobs_work_mode_check CHECK (work_mode IN ('onsite', 'remote', 'hybrid')),
    CONSTRAINT jobs_salary_min_check CHECK (salary_min IS NULL OR salary_min >= 0),
    CONSTRAINT jobs_salary_range_check CHECK (
        salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
    CONSTRAINT jobs_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT jobs_openings_check CHECK (openings BETWEEN 1 AND 500),
    CONSTRAINT jobs_status_check CHECK (status IN ('draft', 'open', 'closed')),
    CONSTRAINT jobs_applicant_count_check CHECK (applicant_count >= 0),
    -- A company with job postings cannot be deleted (preserves hiring history).
    CONSTRAINT jobs_company_fkey FOREIGN KEY (company_id)
        REFERENCES companies (company_id) ON DELETE RESTRICT,
    -- Composite FK: the recruiter must belong to the same company as the job.
    -- If the recruiter is deleted, only recruiter_id becomes NULL (PostgreSQL 15+
    -- column-list syntax); company_id is kept so the job stays with its company.
    CONSTRAINT jobs_recruiter_fkey FOREIGN KEY (recruiter_id, company_id)
        REFERENCES recruiters (user_id, company_id) ON DELETE SET NULL (recruiter_id)
);

CREATE TABLE IF NOT EXISTS job_skills (
    job_id           BIGINT   NOT NULL,
    skill_id         BIGINT   NOT NULL,
    is_required      BOOLEAN  NOT NULL DEFAULT TRUE,  -- FALSE = nice-to-have
    min_proficiency  SMALLINT NOT NULL DEFAULT 3,

    CONSTRAINT job_skills_pkey PRIMARY KEY (job_id, skill_id),
    CONSTRAINT job_skills_min_proficiency_check CHECK (min_proficiency BETWEEN 1 AND 5),
    CONSTRAINT job_skills_job_fkey FOREIGN KEY (job_id)
        REFERENCES jobs (job_id) ON DELETE CASCADE,
    CONSTRAINT job_skills_skill_fkey FOREIGN KEY (skill_id)
        REFERENCES skills (skill_id) ON DELETE RESTRICT
);
