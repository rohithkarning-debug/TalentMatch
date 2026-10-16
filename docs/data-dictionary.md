# TalentMatch — Data Dictionary

This file was written by hand from the live database (`information_schema.columns`) after running migrations 001–014, so it matches the real schema. Triggers, functions and views are described in [advanced-features.md](advanced-features.md).

**Legend:** **PK** primary key · **FK** foreign key · **UK** unique · **NN** NOT NULL · **ID** `GENERATED ALWAYS AS IDENTITY` (auto-number)

All timestamps are `TIMESTAMPTZ` (stored in UTC, shown in local time). Money is `NUMERIC(12,2)` (exact, never floating point).

---

## 1. `users`
Every login account. Its role decides which profile table (if any) holds the extra details.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| user_id | BIGINT | NN | ID | **PK** |
| email | VARCHAR(255) | NN | | **UK** `users_email_key`; CHECK lower-case and basic email format |
| password_hash | VARCHAR(100) | NN | | CHECK must look like a bcrypt hash (`$2a/$2b/$2y$`, 60 chars), so plaintext is rejected |
| full_name | VARCHAR(120) | NN | | CHECK not blank |
| role | VARCHAR(20) | NN | | CHECK IN (`admin`, `recruiter`, `candidate`) |
| is_active | BOOLEAN | NN | `TRUE` | Deactivate instead of delete |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| last_login_at | TIMESTAMPTZ | | | Added by ALTER (009); set by `POST /api/auth/login`. Ignored by the updated_at trigger (014) |
| updated_at | TIMESTAMPTZ | NN | `now()` | Added in 010; set automatically by trigger `set_updated_at()` |

Extra: `UK (user_id, role)` is the target of the profile tables' composite FKs. Index `users_role_idx`.

## 2. `companies`
Hiring organisations.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| company_id | BIGINT | NN | ID | **PK** |
| name | VARCHAR(150) | NN | | **UK**; CHECK not blank |
| industry | VARCHAR(120) | | | Widened from 80 by ALTER (009) |
| location | VARCHAR(120) | | | |
| website | VARCHAR(255) | | | CHECK starts with `http://` or `https://` |
| description | TEXT | | | |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | Added in 010; set automatically by trigger `set_updated_at()` |

## 3. `recruiters`
Profile for users with role `recruiter`. One recruiter works for one company.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| user_id | BIGINT | NN | | **PK**; **FK** `(user_id, role)` → users ON DELETE CASCADE |
| role | VARCHAR(20) | NN | `'recruiter'` | CHECK `= 'recruiter'` (makes the role FK work) |
| company_id | BIGINT | NN | | **FK** → companies ON DELETE RESTRICT |
| designation | VARCHAR(80) | | | e.g. "Technical Recruiter" |
| phone | VARCHAR(20) | | | CHECK digits/spaces/dashes, optional leading `+` |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | Added in 010; set automatically by trigger `set_updated_at()` |

Extra: `UK (user_id, company_id)` is the target of `jobs_recruiter_fkey`.

## 4. `candidates`
Profile for users with role `candidate`.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| user_id | BIGINT | NN | | **PK**; **FK** `(user_id, role)` → users ON DELETE CASCADE |
| role | VARCHAR(20) | NN | `'candidate'` | CHECK `= 'candidate'` |
| phone | VARCHAR(20) | | | Same CHECK as recruiters |
| location | VARCHAR(120) | | | |
| headline | VARCHAR(150) | | | One-line professional summary |
| years_experience | NUMERIC(4,1) | NN | `0` | CHECK 0–60 |
| highest_education | VARCHAR(120) | | | |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | Added in 010; set automatically by trigger `set_updated_at()` |

## 5. `skills`
Shared catalogue of skills used by candidates and jobs.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| skill_id | BIGINT | NN | ID | **PK** |
| name | VARCHAR(60) | NN | | Unique index on `lower(name)` (case-insensitive); CHECK not blank |
| category | VARCHAR(20) | NN | | CHECK IN (`programming`, `frontend`, `backend`, `database`, `ml`, `data`, `devops`, `cloud`) |

## 6. `candidate_skills` (M:N candidates ↔ skills)

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| candidate_id | BIGINT | NN | | **PK** part; **FK** → candidates ON DELETE CASCADE |
| skill_id | BIGINT | NN | | **PK** part; **FK** → skills ON DELETE RESTRICT |
| proficiency | SMALLINT | NN | | CHECK 1 (beginner) – 5 (expert) |
| years_used | NUMERIC(4,1) | NN | `0` | CHECK 0–60 |

## 7. `jobs`
Job postings.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| job_id | BIGINT | NN | ID | **PK** |
| company_id | BIGINT | NN | | **FK** → companies ON DELETE RESTRICT |
| recruiter_id | BIGINT | | | **FK** `(recruiter_id, company_id)` → recruiters(user_id, company_id) ON DELETE SET NULL (recruiter_id) |
| title | VARCHAR(150) | NN | | CHECK not blank |
| description | TEXT | NN | | CHECK ≥ 50 characters (embedded for matching) |
| location | VARCHAR(120) | NN | | |
| work_mode | VARCHAR(10) | NN | `'onsite'` | CHECK IN (`onsite`, `remote`, `hybrid`) |
| salary_min | NUMERIC(12,2) | | | CHECK ≥ 0 |
| salary_max | NUMERIC(12,2) | | | CHECK `jobs_salary_range_check`: `salary_max ≥ salary_min` |
| currency | CHAR(3) | NN | `'INR'` | CHECK three upper-case letters (ISO 4217 style) |
| openings | SMALLINT | NN | `1` | CHECK 1–500 |
| status | VARCHAR(10) | NN | `'open'` | CHECK IN (`draft`, `open`, `closed`) |
| applicant_count | INTEGER | NN | `0` | CHECK ≥ 0; denormalised count maintained by trigger `trg_applications_applicant_count` (011) |
| posted_at | TIMESTAMPTZ | NN | `now()` | |
| closes_at | DATE | | | CHECK `jobs_closes_after_posted_check` (added in 009) |
| employment_type | VARCHAR(20) | NN | `'full_time'` | Added in 009; CHECK IN (`full_time`, `part_time`, `contract`, `internship`) |
| min_experience_years | NUMERIC(4,1) | NN | `0` | Added in 009; CHECK 0–40 |
| updated_at | TIMESTAMPTZ | NN | `now()` | Added in 010; set automatically by trigger `set_updated_at('applicant_count')`; changes to applicant_count alone do not count as an edit |

Indexes: `jobs_company_id_idx`, `jobs_recruiter_id_idx`, **partial** `jobs_open_posted_at_idx (posted_at DESC) WHERE status = 'open'`.

## 8. `job_skills` (M:N jobs ↔ skills)

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| job_id | BIGINT | NN | | **PK** part; **FK** → jobs ON DELETE CASCADE |
| skill_id | BIGINT | NN | | **PK** part; **FK** → skills ON DELETE RESTRICT |
| is_required | BOOLEAN | NN | `TRUE` | FALSE = nice-to-have |
| min_proficiency | SMALLINT | NN | `3` | CHECK 1–5 |

## 9. `resumes`
Uploaded resume files and their extracted text.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| resume_id | BIGINT | NN | ID | **PK** |
| candidate_id | BIGINT | NN | | **FK** → candidates ON DELETE CASCADE |
| file_name | VARCHAR(255) | NN | | Original file name |
| storage_path | VARCHAR(500) | | | **UK**; path under `uploads/`. NULL for seeded text-only resumes |
| mime_type | VARCHAR(100) | NN | `'application/pdf'` | CHECK IN (`application/pdf`, `text/plain`) |
| file_size_bytes | INTEGER | | | CHECK 1 B – 5 MB |
| extracted_text | TEXT | NN | | CHECK ≥ 50 characters; this text is embedded |
| is_primary | BOOLEAN | NN | `FALSE` | **Partial UK** `resumes_one_primary_per_candidate`: one primary per candidate |
| uploaded_at | TIMESTAMPTZ | NN | `now()` | |

## 10. `applications`
A candidate's application to a job. This is the centre of the hiring workflow.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| application_id | BIGINT | NN | ID | **PK** |
| job_id | BIGINT | NN | | **FK** → jobs ON DELETE RESTRICT; **UK** `(job_id, candidate_id)` |
| candidate_id | BIGINT | NN | | **FK** → candidates ON DELETE CASCADE |
| resume_id | BIGINT | | | **FK** → resumes ON DELETE SET NULL |
| cover_letter | TEXT | | | |
| status | VARCHAR(15) | NN | `'applied'` | CHECK IN (`applied`, `shortlisted`, `interviewed`, `offered`, `rejected`). Transitions guarded by trigger (011). Since 018 a deferred constraint trigger checks at COMMIT that `interviewed` has an interview and `offered` has a pending offer |
| match_score | NUMERIC(5,4) | | | CHECK −1 to 1. **Real cosine similarity** `1 − (resume <=> job)`. NULL until embeddings exist, never faked |
| applied_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | CHECK `updated_at ≥ applied_at`; set automatically by trigger since 010 |

Indexes: `applications_candidate_id_idx`, `applications_resume_id_idx`, `applications_job_status_idx (job_id, status)`.

## 11. `application_status_history`
Audit trail: one row per status change, written automatically by trigger `trg_applications_status_history` (011).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| history_id | BIGINT | NN | ID | **PK** |
| application_id | BIGINT | NN | | **FK** → applications ON DELETE CASCADE |
| old_status | VARCHAR(15) | | | NULL for the first entry; CHECK in the 5 statuses |
| new_status | VARCHAR(15) | NN | | CHECK in the 5 statuses; CHECK `old_status IS DISTINCT FROM new_status` |
| changed_by | BIGINT | | | **FK** → users ON DELETE SET NULL |
| note | TEXT | | | |
| changed_at | TIMESTAMPTZ | NN | `now()` | |

## 12. `interviews`

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| interview_id | BIGINT | NN | ID | **PK** |
| application_id | BIGINT | NN | | **FK** → applications ON DELETE CASCADE; **UK** `(application_id, round_no)` |
| round_no | SMALLINT | NN | | CHECK 1–10 |
| scheduled_at | TIMESTAMPTZ | NN | | Indexed. Must be in the future on INSERT and on reschedule (trigger `trg_interviews_guard`, 018) |
| duration_minutes | SMALLINT | NN | `45` | CHECK 15–480 |
| mode | VARCHAR(10) | NN | `'video'` | CHECK IN (`video`, `phone`, `onsite`) |
| location_or_link | VARCHAR(500) | | | Meeting link or address. CHECK `interviews_location_required_check` (018): required unless mode = `phone` |
| interviewer_id | BIGINT | | | **FK** → recruiters ON DELETE SET NULL |
| status | VARCHAR(12) | NN | `'scheduled'` | CHECK IN (`scheduled`, `completed`, `cancelled`, `no_show`). New rows must be `scheduled`; only `scheduled` rows can change; the other three are final and frozen (`trg_interviews_guard`, 018/019). `completed` / `no_show` only once `scheduled_at` has passed (021) |
| rating | SMALLINT | | | CHECK 1–5; CHECK only allowed when status = `completed` |
| feedback | TEXT | | | |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | Added in 010; set automatically by trigger `set_updated_at()` |

Also enforced by `trg_interviews_guard` (018): an interview can only be inserted for a `shortlisted` or `interviewed` application.

## 13. `offers`

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| offer_id | BIGINT | NN | ID | **PK** |
| application_id | BIGINT | NN | | **FK** → applications ON DELETE CASCADE; **UK** (one offer per application) |
| salary_offered | NUMERIC(12,2) | NN | | CHECK > 0 |
| currency | CHAR(3) | NN | `'INR'` | CHECK three upper-case letters |
| joining_date | DATE | NN | | Must be after today (India date, `local_today()`) on INSERT (`trg_offers_guard`, 018) |
| expires_on | DATE | | | CHECK `expires_on ≤ joining_date`. Not in the past on INSERT; an offer can be accepted/declined until the end of this day (`trg_offers_guard`) |
| status | VARCHAR(10) | NN | `'pending'` | CHECK IN (`pending`, `accepted`, `declined`, `withdrawn`). New rows must be `pending`; only `pending` rows can change; the other three are final and frozen (`trg_offers_guard`, 018/019). Accept/decline also needs the application to be `offered`. Becomes `withdrawn` automatically when its application is rejected while the offer is still pending (`trg_applications_withdraw_offer`, 020) |
| offered_at | TIMESTAMPTZ | NN | `now()` | |
| responded_at | TIMESTAMPTZ | | | CHECK: NULL while pending, set once accepted/declined |
| updated_at | TIMESTAMPTZ | NN | `now()` | Added in 010; set automatically by trigger `set_updated_at()` |

## 14. `notifications`
In-app messages shown to a user.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| notification_id | BIGINT | NN | ID | **PK** |
| user_id | BIGINT | NN | | **FK** → users ON DELETE CASCADE |
| type | VARCHAR(30) | NN | | CHECK IN (`application_submitted`, `status_changed`, `interview_scheduled`, `offer_made`, `system`, and since 018 `interview_updated`, `offer_responded`, `offer_withdrawn`) |
| title | VARCHAR(150) | NN | | CHECK not blank |
| message | TEXT | NN | | |
| related_application_id | BIGINT | | | **FK** → applications ON DELETE SET NULL |
| is_read | BOOLEAN | NN | `FALSE` | **Partial** index `notifications_unread_idx WHERE NOT is_read` |
| created_at | TIMESTAMPTZ | NN | `now()` | Index `(user_id, created_at DESC)` |

## 15. `resume_embeddings` (vector store)

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| resume_id | BIGINT | NN | | **PK** and **FK** → resumes ON DELETE CASCADE (one vector per resume) |
| embedding | vector(384) | NN | | CHECK unit length (`abs(vector_norm − 1) < 0.001`); **HNSW** index `vector_cosine_ops` |
| model_name | VARCHAR(100) | NN | `'sentence-transformers/all-MiniLM-L6-v2'` | Which model produced the vector |
| chunk_count | SMALLINT | NN | | CHECK ≥ 1; number of text chunks averaged |
| source_hash | CHAR(64) | NN | | CHECK 64 hex chars; SHA-256 of the embedded text (detects stale vectors) |
| created_at | TIMESTAMPTZ | NN | `now()` | |

## 16. `job_embeddings` (vector store)

Same structure as `resume_embeddings`, with `job_id` as **PK** and **FK** → jobs ON DELETE CASCADE.

---

## Bookkeeping (not an application table)

`tm_meta.schema_migrations(version PK, filename UK, checksum CHAR(64), applied_at)` is written only by `scripts/migrate.js`. It records which migration files have been applied and their SHA-256 checksums.
