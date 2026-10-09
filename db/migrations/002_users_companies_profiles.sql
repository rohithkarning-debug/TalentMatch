-- 002: Identity and organisation tables
--   users       — every login account (admin / recruiter / candidate)
--   companies   — hiring organisations
--   recruiters  — profile for users whose role is 'recruiter'  (PK = FK users)
--   candidates  — profile for users whose role is 'candidate'  (PK = FK users)

CREATE TABLE IF NOT EXISTS users (
    user_id        BIGINT GENERATED ALWAYS AS IDENTITY,
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(100) NOT NULL,
    full_name      VARCHAR(120) NOT NULL,
    role           VARCHAR(20)  NOT NULL,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT users_pkey PRIMARY KEY (user_id),
    CONSTRAINT users_email_key UNIQUE (email),
    -- Emails are stored lower-case so 'A@x.com' and 'a@x.com' cannot both exist.
    CONSTRAINT users_email_format_check
        CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    -- Only bcrypt hashes are accepted, never plaintext passwords.
    CONSTRAINT users_password_hash_bcrypt_check
        CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'),
    CONSTRAINT users_full_name_not_blank_check CHECK (btrim(full_name) <> ''),
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'recruiter', 'candidate')),
    -- Target for the (user_id, role) foreign keys in recruiters/candidates.
    CONSTRAINT users_user_id_role_key UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS companies (
    company_id   BIGINT GENERATED ALWAYS AS IDENTITY,
    name         VARCHAR(150) NOT NULL,
    industry     VARCHAR(80),
    location     VARCHAR(120),
    website      VARCHAR(255),
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT companies_pkey PRIMARY KEY (company_id),
    CONSTRAINT companies_name_key UNIQUE (name),
    CONSTRAINT companies_name_not_blank_check CHECK (btrim(name) <> ''),
    CONSTRAINT companies_website_check CHECK (website IS NULL OR website ~ '^https?://')
);

CREATE TABLE IF NOT EXISTS recruiters (
    user_id      BIGINT      NOT NULL,
    -- Always 'recruiter'. Together with the composite FK below it guarantees
    -- that only a user whose role is 'recruiter' can have a recruiter profile.
    role         VARCHAR(20) NOT NULL DEFAULT 'recruiter',
    company_id   BIGINT      NOT NULL,
    designation  VARCHAR(80),
    phone        VARCHAR(20),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT recruiters_pkey PRIMARY KEY (user_id),
    CONSTRAINT recruiters_role_check CHECK (role = 'recruiter'),
    CONSTRAINT recruiters_phone_check CHECK (phone IS NULL OR phone ~ '^\+?[0-9][0-9 -]{6,18}$'),
    -- Deleting the user account deletes the recruiter profile.
    -- Changing the user's role is blocked while this profile exists (NO ACTION).
    CONSTRAINT recruiters_user_fkey FOREIGN KEY (user_id, role)
        REFERENCES users (user_id, role) ON DELETE CASCADE,
    -- A company that still employs recruiters cannot be deleted.
    CONSTRAINT recruiters_company_fkey FOREIGN KEY (company_id)
        REFERENCES companies (company_id) ON DELETE RESTRICT,
    -- Target for jobs (recruiter_id, company_id) FK: a recruiter can only own
    -- jobs of their own company.
    CONSTRAINT recruiters_user_id_company_id_key UNIQUE (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS candidates (
    user_id            BIGINT       NOT NULL,
    role               VARCHAR(20)  NOT NULL DEFAULT 'candidate',
    phone              VARCHAR(20),
    location           VARCHAR(120),
    headline           VARCHAR(150),
    years_experience   NUMERIC(4,1) NOT NULL DEFAULT 0,
    highest_education  VARCHAR(120),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT candidates_pkey PRIMARY KEY (user_id),
    CONSTRAINT candidates_role_check CHECK (role = 'candidate'),
    CONSTRAINT candidates_phone_check CHECK (phone IS NULL OR phone ~ '^\+?[0-9][0-9 -]{6,18}$'),
    CONSTRAINT candidates_years_experience_check CHECK (years_experience BETWEEN 0 AND 60),
    CONSTRAINT candidates_user_fkey FOREIGN KEY (user_id, role)
        REFERENCES users (user_id, role) ON DELETE CASCADE
);
