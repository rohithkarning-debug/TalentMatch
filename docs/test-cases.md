# TalentMatch — Test Cases and Results

## Stage 1 — Schema and constraint tests

Script: `db/tests/stage1_constraint_tests.sql`. Each test runs inside `BEGIN … ROLLBACK`, so seeded data is never changed.

Run it from the project root (PowerShell):
```powershell
Get-Content db/tests/stage1_constraint_tests.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
```

Results recorded on 2026-10-09 against PostgreSQL 17.11 + pgvector 0.8.7:

| # | Test | Expected | Actual PostgreSQL error | Rejected by | Result |
|---|---|---|---|---|---|
| 1 | Insert a user with an existing email | Reject | `duplicate key value violates unique constraint "users_email_key"` — `Key (email)=(aditi.sharma@mail.example) already exists.` | UNIQUE `users_email_key` | Pass |
| 2 | Set an application's status to `hired` | Reject | `new row for relation "applications" violates check constraint "applications_status_check"` | CHECK `applications_status_check` | Pass |
| 3 | Insert a job with salary_min 1,500,000 and salary_max 900,000 | Reject | `new row for relation "jobs" violates check constraint "jobs_salary_range_check"` | CHECK `jobs_salary_range_check` | Pass |
| 4 | Apply twice to the same job with the same candidate | Reject | `duplicate key value violates unique constraint "applications_job_id_candidate_id_key"` — `Key (job_id, candidate_id)=(1, 16) already exists.` | UNIQUE `(job_id, candidate_id)` | Pass |
| 5 | Application for job_id 999999 (doesn't exist) | Reject | `insert or update on table "applications" violates foreign key constraint "applications_job_fkey"` — `Key (job_id)=(999999) is not present in table "jobs".` | FK `applications_job_fkey` | Pass |
| 6 (bonus) | Create a candidate profile for a recruiter account | Reject | `violates foreign key constraint "candidates_user_fkey"` — `Key (user_id, role)=(2, candidate) is not present in table "users".` | Composite FK `(user_id, role)` | Pass |
| 7 (bonus) | Store the plaintext password `password123` | Reject | `new row for relation "users" violates check constraint "users_password_hash_bcrypt_check"` | CHECK bcrypt format | Pass |
| 8 (bonus) | Delete a company that still has recruiters and jobs | Reject | `update or delete on table "companies" violates foreign key constraint "recruiters_company_fkey" on table "recruiters"` | FK ON DELETE RESTRICT | Pass |

Row counts (users/jobs/applications/companies) were `17/8/16/3` both before and after the tests.

## Stage 1 — Migration, seed and reset checks

| Check | Result |
|---|---|
| `npm run db:migrate` on an empty database | 9 applied |
| `npm run db:migrate` run again | 0 applied, 9 skipped (tracked in `tm_meta.schema_migrations` with SHA-256 checksums) |
| `npm run db:seed` run twice | Identical row counts both times (idempotent) |
| Tables in `public` | 16 |
| Constraints | 16 PK, 22 FK, 8 UNIQUE, 56 CHECK |
| Indexes | 46 total, including 2 HNSW (`vector_cosine_ops`) and 3 partial |
| `applicant_count` vs real `COUNT(*)` | Equal for all 8 jobs |
| Latest history status vs `applications.status` | 0 mismatches |
| `match_score` | NULL for all 16 applications (no fake scores) |
| `db:reset` with DATABASE_URL pointing at the native Postgres (port 5432 / db `postgres`) | Refused, nothing changed |
| `db:reset` with a non-local host | Refused |
| `db:reset` with a wrong confirmation typed | Cancelled, nothing changed |
| `db:reset -- --yes` → `db:migrate` → `db:seed` | 0 tables after reset; full rebuild; constraint tests pass again |
| `GET /api/health` (production build) | HTTP 200, PostgreSQL 17.11, pgvector 0.8.7 |
| `npm run build` | Passes |
