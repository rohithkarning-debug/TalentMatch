-- 005: Resumes, job applications, and the application status audit trail.

CREATE TABLE IF NOT EXISTS resumes (
    resume_id        BIGINT GENERATED ALWAYS AS IDENTITY,
    candidate_id     BIGINT       NOT NULL,
    file_name        VARCHAR(255) NOT NULL,
    storage_path     VARCHAR(500),                -- path under uploads/; NULL for seeded text-only resumes
    mime_type        VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    file_size_bytes  INTEGER,
    extracted_text   TEXT         NOT NULL,       -- text that gets embedded
    is_primary       BOOLEAN      NOT NULL DEFAULT FALSE,
    uploaded_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT resumes_pkey PRIMARY KEY (resume_id),
    CONSTRAINT resumes_storage_path_key UNIQUE (storage_path),
    CONSTRAINT resumes_mime_type_check CHECK (mime_type IN ('application/pdf', 'text/plain')),
    -- Uploads are limited to 5 MB.
    CONSTRAINT resumes_file_size_check CHECK (
        file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 5242880),
    CONSTRAINT resumes_extracted_text_length_check CHECK (length(btrim(extracted_text)) >= 50),
    CONSTRAINT resumes_candidate_fkey FOREIGN KEY (candidate_id)
        REFERENCES candidates (user_id) ON DELETE CASCADE
);

-- At most ONE primary resume per candidate (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_primary_per_candidate
    ON resumes (candidate_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS applications (
    application_id  BIGINT GENERATED ALWAYS AS IDENTITY,
    job_id          BIGINT       NOT NULL,
    candidate_id    BIGINT       NOT NULL,
    resume_id       BIGINT,
    cover_letter    TEXT,
    status          VARCHAR(15)  NOT NULL DEFAULT 'applied',
    -- Cosine similarity between resume and job embeddings (1 - cosine distance).
    -- NULL until computed from real embeddings; never filled with fake values.
    match_score     NUMERIC(5,4),
    applied_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT applications_pkey PRIMARY KEY (application_id),
    -- A candidate can apply to a given job only once.
    CONSTRAINT applications_job_id_candidate_id_key UNIQUE (job_id, candidate_id),
    CONSTRAINT applications_status_check CHECK (status IN
        ('applied', 'shortlisted', 'interviewed', 'offered', 'rejected')),
    CONSTRAINT applications_match_score_check CHECK (
        match_score IS NULL OR match_score BETWEEN -1 AND 1),
    CONSTRAINT applications_updated_after_applied_check CHECK (updated_at >= applied_at),
    -- Jobs with applications cannot be deleted; close them instead.
    CONSTRAINT applications_job_fkey FOREIGN KEY (job_id)
        REFERENCES jobs (job_id) ON DELETE RESTRICT,
    -- Deleting a candidate account removes their applications (privacy).
    CONSTRAINT applications_candidate_fkey FOREIGN KEY (candidate_id)
        REFERENCES candidates (user_id) ON DELETE CASCADE,
    -- Deleting a resume file keeps the application record.
    CONSTRAINT applications_resume_fkey FOREIGN KEY (resume_id)
        REFERENCES resumes (resume_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS application_status_history (
    history_id      BIGINT GENERATED ALWAYS AS IDENTITY,
    application_id  BIGINT      NOT NULL,
    old_status      VARCHAR(15),                  -- NULL for the initial 'applied' entry
    new_status      VARCHAR(15) NOT NULL,
    changed_by      BIGINT,                       -- user who made the change
    note            TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT application_status_history_pkey PRIMARY KEY (history_id),
    CONSTRAINT ash_old_status_check CHECK (old_status IS NULL OR old_status IN
        ('applied', 'shortlisted', 'interviewed', 'offered', 'rejected')),
    CONSTRAINT ash_new_status_check CHECK (new_status IN
        ('applied', 'shortlisted', 'interviewed', 'offered', 'rejected')),
    CONSTRAINT ash_status_changed_check CHECK (old_status IS DISTINCT FROM new_status),
    CONSTRAINT ash_application_fkey FOREIGN KEY (application_id)
        REFERENCES applications (application_id) ON DELETE CASCADE,
    -- Keep the audit row even if the user who made the change is deleted.
    CONSTRAINT ash_changed_by_fkey FOREIGN KEY (changed_by)
        REFERENCES users (user_id) ON DELETE SET NULL
);
