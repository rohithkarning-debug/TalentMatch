# TalentMatch — Relational Schema

The schema is defined by `db/migrations/001–013` and has **16 tables** in the `public` schema. Migration bookkeeping lives separately in `tm_meta.schema_migrations`, so it is kept out of the application schema.

Notation: **underlined** = primary key (written here as <u>pk</u>), *italic* = foreign key, `UK` = unique.

## 1. Why one PostgreSQL database for both SQL and vectors

TalentMatch handles two kinds of data:

| Data | Nature | Stored in | Why |
|---|---|---|---|
| Users, companies, jobs, applications, interviews, offers… | Highly **structured**, linked by relationships, must stay consistent (e.g. one application per job per candidate, one offer per application) | **PostgreSQL relational tables** | PK/FK, UNIQUE and CHECK constraints, transactions and joins guarantee integrity. That is exactly what a hiring workflow needs. |
| Resume text and job descriptions | **Unstructured** free text, where *meaning* matters more than exact keywords | **pgvector** columns `vector(384)` in `resume_embeddings` and `job_embeddings` | A sentence-embedding model turns text into a 384-number vector. Texts with similar meaning get nearby vectors, so "built REST services in Express" can match a job asking for "Node.js API development". |

**Why the same database (pgvector) instead of a separate vector DB (Pinecone, Qdrant…)?**

1. **One query can mix both.** Ranking candidates is a SQL JOIN plus a vector similarity sort (`ORDER BY embedding <=> $1`) filtered by normal columns such as job status or company. With a separate vector DB, the app would have to fetch IDs from one system and look them up in the other.
2. **Referential integrity for vectors.** Embeddings have real foreign keys with `ON DELETE CASCADE`. Deleting a resume deletes its vector, and a vector can never point at a missing resume.
3. **Transactions and consistency.** Embeddings are ordinary rows, so upserts, cascading deletes and the ranking query all see one consistent database. (We deliberately commit the resume upload *before* embedding it, so a model failure can't lose the upload; see [vector-design.md §5](vector-design.md#failure-handling-on-upload).)
4. **Simpler to run.** One Docker container, one backup, one set of credentials.
5. **Scale fits.** A single-organisation recruitment system has thousands of resumes, not billions. pgvector's HNSW index is more than enough.

## 2. Tables

```
users(<u>user_id</u>, email UK, password_hash, full_name, role, is_active, created_at, last_login_at)
      UK(user_id, role)

companies(<u>company_id</u>, name UK, industry, location, website, description, created_at)

recruiters(<u>*user_id*</u>, role, *company_id*, designation, phone, created_at)
      FK (user_id, role) → users(user_id, role)
      FK company_id → companies
      UK (user_id, company_id)

candidates(<u>*user_id*</u>, role, phone, location, headline, years_experience, highest_education, created_at)
      FK (user_id, role) → users(user_id, role)

skills(<u>skill_id</u>, name, category)                       UK lower(name)

candidate_skills(<u>*candidate_id*, *skill_id*</u>, proficiency, years_used)
      FK candidate_id → candidates(user_id);  FK skill_id → skills

jobs(<u>job_id</u>, *company_id*, *recruiter_id*, title, description, location, work_mode,
     salary_min, salary_max, currency, openings, status, applicant_count, posted_at, closes_at,
     employment_type, min_experience_years)
      FK company_id → companies
      FK (recruiter_id, company_id) → recruiters(user_id, company_id)

job_skills(<u>*job_id*, *skill_id*</u>, is_required, min_proficiency)
      FK job_id → jobs;  FK skill_id → skills

resumes(<u>resume_id</u>, *candidate_id*, file_name, storage_path UK, mime_type, file_size_bytes,
        extracted_text, is_primary, uploaded_at)
      FK candidate_id → candidates(user_id)
      partial UK (candidate_id) WHERE is_primary

applications(<u>application_id</u>, *job_id*, *candidate_id*, *resume_id*, cover_letter, status,
             match_score, applied_at, updated_at)
      UK (job_id, candidate_id)
      FK job_id → jobs;  FK candidate_id → candidates(user_id);  FK resume_id → resumes

application_status_history(<u>history_id</u>, *application_id*, old_status, new_status, *changed_by*, note, changed_at)
      FK application_id → applications;  FK changed_by → users

interviews(<u>interview_id</u>, *application_id*, round_no, scheduled_at, duration_minutes, mode,
           location_or_link, *interviewer_id*, status, rating, feedback, created_at)
      UK (application_id, round_no)
      FK application_id → applications;  FK interviewer_id → recruiters(user_id)

offers(<u>offer_id</u>, *application_id* UK, salary_offered, currency, joining_date, expires_on,
       status, offered_at, responded_at)
      FK application_id → applications

notifications(<u>notification_id</u>, *user_id*, type, title, message, *related_application_id*, is_read, created_at)
      FK user_id → users;  FK related_application_id → applications

resume_embeddings(<u>*resume_id*</u>, embedding vector(384), model_name, chunk_count, source_hash, created_at)
      FK resume_id → resumes

job_embeddings(<u>*job_id*</u>, embedding vector(384), model_name, chunk_count, source_hash, created_at)
      FK job_id → jobs
```

## 3. Foreign keys and `ON DELETE` behaviour

Every foreign key has a deliberate delete rule. The general idea:

- **CASCADE** when the child cannot exist without its parent (a profile without its user, a skill row without its candidate).
- **RESTRICT** when deleting the parent would destroy business history. The user must close or deactivate the parent instead.
- **SET NULL** when the child record is still valuable without the link (an audit row whose author was deleted).

| FK constraint | Child → Parent | ON DELETE | Reason |
|---|---|---|---|
| `recruiters_user_fkey` | recruiters(user_id, role) → users | CASCADE | Deleting the account removes the profile |
| `recruiters_company_fkey` | recruiters → companies | RESTRICT | Cannot delete a company that still has recruiters |
| `candidates_user_fkey` | candidates(user_id, role) → users | CASCADE | Deleting the account removes the profile |
| `candidate_skills_candidate_fkey` | candidate_skills → candidates | CASCADE | Skill list belongs to the candidate |
| `candidate_skills_skill_fkey` | candidate_skills → skills | RESTRICT | Cannot remove a skill that is still in use |
| `jobs_company_fkey` | jobs → companies | RESTRICT | Preserves hiring history; close jobs instead |
| `jobs_recruiter_fkey` | jobs(recruiter_id, company_id) → recruiters | SET NULL (recruiter_id) | Job stays with the company if the recruiter leaves. Only `recruiter_id` is cleared (PostgreSQL 15+ column-list syntax) |
| `job_skills_job_fkey` | job_skills → jobs | CASCADE | Requirements belong to the job |
| `job_skills_skill_fkey` | job_skills → skills | RESTRICT | Cannot remove a skill that is still required |
| `resumes_candidate_fkey` | resumes → candidates | CASCADE | Candidate's own documents (privacy) |
| `applications_job_fkey` | applications → jobs | RESTRICT | A job with applicants must be closed, not deleted |
| `applications_candidate_fkey` | applications → candidates | CASCADE | Candidate account deletion removes their personal data |
| `applications_resume_fkey` | applications → resumes | SET NULL | Application survives if the resume file is replaced |
| `ash_application_fkey` | application_status_history → applications | CASCADE | History belongs to the application |
| `ash_changed_by_fkey` | application_status_history → users | SET NULL | Keep the audit entry even if its author is deleted |
| `interviews_application_fkey` | interviews → applications | CASCADE | Interviews belong to the application |
| `interviews_interviewer_fkey` | interviews → recruiters | SET NULL | Keep interview records if the interviewer leaves |
| `offers_application_fkey` | offers → applications | CASCADE | Offer belongs to the application |
| `notifications_user_fkey` | notifications → users | CASCADE | A user's inbox goes with the user |
| `notifications_application_fkey` | notifications → applications | SET NULL | Keep the message text |
| `resume_embeddings_resume_fkey` | resume_embeddings → resumes | CASCADE | Vector is derived data |
| `job_embeddings_job_fkey` | job_embeddings → jobs | CASCADE | Vector is derived data |

**Note on CASCADE vs RESTRICT chains:** deleting a candidate cascades to their applications. If a job has applications, `applications_job_fkey` (RESTRICT) blocks deleting the job, and `jobs_company_fkey` / `recruiters_company_fkey` block deleting the company. Recruitment history therefore can't be wiped out by accident.

## 4. Indexes (migration 008 plus the ones in 003, 005 and 007)

PostgreSQL automatically indexes primary keys and UNIQUE constraints, but **not** foreign-key columns. Migration 008 adds B-tree indexes on every FK column that isn't already the first column of an existing index.

Three composite FKs (`recruiters_user_fkey`, `candidates_user_fkey`, `jobs_recruiter_fkey`) have no index covering *all* their columns. They don't need one: their first column (`user_id`, which is the PK, or `recruiter_id` via `jobs_recruiter_id_idx`) is already indexed and nearly unique, so lookups stay fast.

| Index | Type | Purpose |
|---|---|---|
| `skills_name_lower_key` | UNIQUE on `lower(name)` | Case-insensitive unique skill names |
| `resumes_one_primary_per_candidate` | **Partial** UNIQUE `WHERE is_primary` | At most one primary resume per candidate |
| `jobs_open_posted_at_idx` | **Partial** `WHERE status = 'open'` | "Browse open jobs, newest first". Only indexes open jobs, so the index stays small |
| `notifications_unread_idx` | **Partial** `WHERE NOT is_read` | Unread-notification badge |
| `applications_job_status_idx` | B-tree (job_id, status) | Recruiter pipeline per job and stage |
| `notifications_user_created_idx` | B-tree (user_id, created_at DESC) | User inbox, newest first |
| `resume_embeddings_embedding_hnsw_idx` | **HNSW** `vector_cosine_ops` | Fast nearest-neighbour search by cosine distance |
| `job_embeddings_embedding_hnsw_idx` | **HNSW** `vector_cosine_ops` | Same, for jobs |
| …plus 12 FK indexes and `users_role_idx`, `interviews_scheduled_at_idx` | B-tree | Joins and FK checks |

## 5. Schema evolution (ALTER TABLE) — migration 009

| Statement | What it shows |
|---|---|
| `ALTER TABLE jobs ADD COLUMN employment_type … DEFAULT 'full_time' CHECK (...)` | Adding a NOT NULL column safely by supplying a default |
| `ALTER TABLE jobs ADD COLUMN min_experience_years` + `ADD CONSTRAINT jobs_min_experience_check` | Adding a named CHECK constraint after creation |
| `ALTER TABLE users ADD COLUMN last_login_at` | Adding a nullable column |
| `ALTER TABLE companies ALTER COLUMN industry TYPE VARCHAR(120)` | Changing a column's data type |
| `ALTER TABLE jobs ADD CONSTRAINT jobs_closes_after_posted_check` | Cross-column CHECK added later |

`DROP` is shown in `db/reset.sql` (`DROP TABLE … CASCADE`, `DROP SCHEMA`) and in migration 009 (`DROP CONSTRAINT IF EXISTS`).

## 6. Normalisation

- **1NF:** every column is atomic. Skills are rows in `candidate_skills` / `job_skills`, not comma-separated lists.
- **2NF:** in tables with composite keys (`candidate_skills`, `job_skills`), every non-key column (proficiency, years_used, is_required, min_proficiency) depends on the *whole* key.
- **3NF:** no column depends on another non-key column. For example, company details live in `companies`, not repeated in `jobs`.
- **Deliberate denormalisation:** `jobs.applicant_count` duplicates `COUNT(applications)` for fast job listings. Trigger `trg_applications_applicant_count` (migration 011) keeps it correct on every INSERT/DELETE/job change, and a TRUNCATE trigger resets it.
- **Role column in profiles:** `recruiters.role` and `candidates.role` are constant columns (`CHECK role = 'recruiter'`). They exist only so a composite FK can enforce the user's role at the database level, without a trigger.

## 7. Triggers, functions and views (migrations 010–013)

These are described in detail, with test output, in [advanced-features.md](advanced-features.md). In short:

- **010:** an `updated_at` column on users, companies, recruiters, candidates, jobs, interviews and offers (applications already had one), kept current by the generic `set_updated_at()` BEFORE UPDATE trigger.
- **011:** `applicant_count` maintenance, the status-transition guard, the automatic status history, and "new applications start as `applied`".
- **012:** `generate_hiring_pipeline_report()` and `update_application_status()`.
- **013:** `recruiter_pipeline_view`, `candidate_application_view`, `company_hiring_summary`.
