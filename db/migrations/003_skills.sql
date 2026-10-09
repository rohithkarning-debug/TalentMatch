-- 003: Skills catalogue and the candidates <-> skills many-to-many relationship.

CREATE TABLE IF NOT EXISTS skills (
    skill_id  BIGINT GENERATED ALWAYS AS IDENTITY,
    name      VARCHAR(60) NOT NULL,
    category  VARCHAR(20) NOT NULL,

    CONSTRAINT skills_pkey PRIMARY KEY (skill_id),
    CONSTRAINT skills_name_not_blank_check CHECK (btrim(name) <> ''),
    CONSTRAINT skills_category_check CHECK (category IN
        ('programming', 'frontend', 'backend', 'database', 'ml', 'data', 'devops', 'cloud'))
);

-- Case-insensitive uniqueness: 'Python' and 'python' are the same skill.
CREATE UNIQUE INDEX IF NOT EXISTS skills_name_lower_key ON skills (lower(name));

CREATE TABLE IF NOT EXISTS candidate_skills (
    candidate_id  BIGINT       NOT NULL,
    skill_id      BIGINT       NOT NULL,
    proficiency   SMALLINT     NOT NULL,          -- 1 = beginner … 5 = expert
    years_used    NUMERIC(4,1) NOT NULL DEFAULT 0,

    CONSTRAINT candidate_skills_pkey PRIMARY KEY (candidate_id, skill_id),
    CONSTRAINT candidate_skills_proficiency_check CHECK (proficiency BETWEEN 1 AND 5),
    CONSTRAINT candidate_skills_years_used_check CHECK (years_used BETWEEN 0 AND 60),
    -- Removing a candidate removes their skill list.
    CONSTRAINT candidate_skills_candidate_fkey FOREIGN KEY (candidate_id)
        REFERENCES candidates (user_id) ON DELETE CASCADE,
    -- A skill that candidates still list cannot be deleted from the catalogue.
    CONSTRAINT candidate_skills_skill_fkey FOREIGN KEY (skill_id)
        REFERENCES skills (skill_id) ON DELETE RESTRICT
);
