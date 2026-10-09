# TalentMatch — ER Diagram

This diagram is written in Mermaid `erDiagram` syntax. GitHub and VS Code (with a Mermaid extension) render it automatically. It matches `db/migrations/001–009`.

**Notation:** `||` means exactly one, `o|` zero or one, `|{` one or more, `o{` zero or more.
`PK` = primary key, `FK` = foreign key, `UK` = unique.

```mermaid
erDiagram
    USERS ||--o| RECRUITERS : "has profile (role = recruiter)"
    USERS ||--o| CANDIDATES : "has profile (role = candidate)"
    USERS ||--o{ NOTIFICATIONS : receives
    USERS |o--o{ APPLICATION_STATUS_HISTORY : "changed_by"

    COMPANIES ||--o{ RECRUITERS : employs
    COMPANIES ||--o{ JOBS : posts
    RECRUITERS |o--o{ JOBS : manages
    RECRUITERS |o--o{ INTERVIEWS : conducts

    CANDIDATES ||--o{ CANDIDATE_SKILLS : lists
    SKILLS ||--o{ CANDIDATE_SKILLS : "is listed in"
    JOBS ||--o{ JOB_SKILLS : requires
    SKILLS ||--o{ JOB_SKILLS : "is required by"

    CANDIDATES ||--o{ RESUMES : uploads
    CANDIDATES ||--o{ APPLICATIONS : submits
    JOBS ||--o{ APPLICATIONS : receives
    RESUMES |o--o{ APPLICATIONS : "attached to"

    APPLICATIONS ||--o{ APPLICATION_STATUS_HISTORY : "audited by"
    APPLICATIONS ||--o{ INTERVIEWS : schedules
    APPLICATIONS ||--o| OFFERS : "results in"
    APPLICATIONS |o--o{ NOTIFICATIONS : "referenced by"

    RESUMES ||--o| RESUME_EMBEDDINGS : "embedded as"
    JOBS ||--o| JOB_EMBEDDINGS : "embedded as"

    USERS {
        bigint user_id PK
        varchar email UK "lower-case, format CHECK"
        varchar password_hash "bcrypt only (CHECK)"
        varchar full_name
        varchar role "admin | recruiter | candidate"
        boolean is_active
        timestamptz created_at
        timestamptz last_login_at "added by ALTER (009)"
    }
    COMPANIES {
        bigint company_id PK
        varchar name UK
        varchar industry
        varchar location
        varchar website
        text description
        timestamptz created_at
    }
    RECRUITERS {
        bigint user_id PK,FK "→ users (with role)"
        varchar role "always 'recruiter'"
        bigint company_id FK
        varchar designation
        varchar phone
        timestamptz created_at
    }
    CANDIDATES {
        bigint user_id PK,FK "→ users (with role)"
        varchar role "always 'candidate'"
        varchar phone
        varchar location
        varchar headline
        numeric years_experience
        varchar highest_education
        timestamptz created_at
    }
    SKILLS {
        bigint skill_id PK
        varchar name UK "case-insensitive"
        varchar category
    }
    CANDIDATE_SKILLS {
        bigint candidate_id PK,FK
        bigint skill_id PK,FK
        smallint proficiency "1-5"
        numeric years_used
    }
    JOBS {
        bigint job_id PK
        bigint company_id FK
        bigint recruiter_id FK "nullable"
        varchar title
        text description
        varchar location
        varchar work_mode
        numeric salary_min
        numeric salary_max "≥ salary_min"
        char currency
        smallint openings
        varchar status "draft | open | closed"
        int applicant_count
        timestamptz posted_at
        date closes_at
        varchar employment_type "added by ALTER (009)"
        numeric min_experience_years "added by ALTER (009)"
    }
    JOB_SKILLS {
        bigint job_id PK,FK
        bigint skill_id PK,FK
        boolean is_required
        smallint min_proficiency
    }
    RESUMES {
        bigint resume_id PK
        bigint candidate_id FK
        varchar file_name
        varchar storage_path UK
        varchar mime_type
        int file_size_bytes
        text extracted_text
        boolean is_primary "one per candidate"
        timestamptz uploaded_at
    }
    APPLICATIONS {
        bigint application_id PK
        bigint job_id FK "UK with candidate_id"
        bigint candidate_id FK
        bigint resume_id FK "nullable"
        text cover_letter
        varchar status "5 allowed values"
        numeric match_score "cosine similarity"
        timestamptz applied_at
        timestamptz updated_at
    }
    APPLICATION_STATUS_HISTORY {
        bigint history_id PK
        bigint application_id FK
        varchar old_status
        varchar new_status
        bigint changed_by FK
        text note
        timestamptz changed_at
    }
    INTERVIEWS {
        bigint interview_id PK
        bigint application_id FK "UK with round_no"
        smallint round_no
        timestamptz scheduled_at
        smallint duration_minutes
        varchar mode
        varchar location_or_link
        bigint interviewer_id FK
        varchar status
        smallint rating
        text feedback
        timestamptz created_at
    }
    OFFERS {
        bigint offer_id PK
        bigint application_id FK,UK
        numeric salary_offered
        char currency
        date joining_date
        date expires_on
        varchar status
        timestamptz offered_at
        timestamptz responded_at
    }
    NOTIFICATIONS {
        bigint notification_id PK
        bigint user_id FK
        varchar type
        varchar title
        text message
        bigint related_application_id FK
        boolean is_read
        timestamptz created_at
    }
    RESUME_EMBEDDINGS {
        bigint resume_id PK,FK
        vector embedding "vector(384), HNSW"
        varchar model_name
        smallint chunk_count
        char source_hash
        timestamptz created_at
    }
    JOB_EMBEDDINGS {
        bigint job_id PK,FK
        vector embedding "vector(384), HNSW"
        varchar model_name
        smallint chunk_count
        char source_hash
        timestamptz created_at
    }
```

## Key relationship notes

| Relationship | Type | How it is enforced |
|---|---|---|
| users → recruiters / candidates | 1 : 0..1 (specialisation) | The profile's PK is also its FK to `users`. A composite FK `(user_id, role)` makes sure only a user with role `recruiter` can have a recruiter profile, and likewise for candidates. |
| companies → recruiters | 1 : N | `recruiters.company_id` FK |
| companies → jobs | 1 : N | `jobs.company_id` FK |
| recruiters → jobs | 1 : N (optional) | Composite FK `(recruiter_id, company_id)`, so a recruiter can only manage jobs of their own company |
| candidates ↔ skills | M : N | Junction table `candidate_skills` with composite PK |
| jobs ↔ skills | M : N | Junction table `job_skills` with composite PK |
| candidates ↔ jobs | M : N through `applications` | `UNIQUE (job_id, candidate_id)`: one application per job per candidate |
| applications → offers | 1 : 0..1 | `UNIQUE (application_id)` on `offers` |
| applications → interviews | 1 : N | `UNIQUE (application_id, round_no)` |
| resumes → resume_embeddings | 1 : 0..1 | Embedding PK = FK to `resumes` |
| jobs → job_embeddings | 1 : 0..1 | Embedding PK = FK to `jobs` |
