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

## Stage 2 — Triggers, functions, views, queries, transactions

Script: `db/tests/stage2_advanced_tests.sql`. It runs in one transaction that is rolled back, and every check is an `ASSERT`.
```powershell
Get-Content db/tests/stage2_advanced_tests.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
```
Results recorded on 2026-10-09 on a freshly reset, migrated and seeded database. Full output is in [advanced-features.md §6](advanced-features.md#6-test-results-dbtestsstage2_advanced_testssql).

| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| T1 | Insert an application | applicant_count +1; history `NULL → applied` by the candidate | 2 → 3; history row written, changed_by = candidate | Pass |
| T2 | Delete that application | applicant_count −1 | 3 → 2 | Pass |
| T3 | Move an application to another job, edit a non-job column, move it back | −1/+1, no change, then back | old 2→1→2, new 2→3→2 | Pass |
| T4 | Status applied → shortlisted with actor + note set | History row with actor and note | `applied → shortlisted by user 3, "Good SQL test score"` | Pass |
| T5 | applied→offered, applied→interviewed, rejected→shortlisted, offered→interviewed, interviewed→applied | All rejected, no history | 5/5 `Invalid application status transition …` (check_violation), 0 history rows | Pass |
| T6 | Full valid path, then a same-status update | 5 history rows; no-op not logged | 5 rows, no-op ignored | Pass |
| T7 | Insert a new application as `offered` | Rejected | `A new application must start with status 'applied' (got offered)` | Pass |
| T8a–e | updated_at: real edit / no-op / counter-only change / status change / profile edit | Refreshed / unchanged / unchanged / refreshed / refreshed | As expected (e.g. jobs 2026-01-01 → now(); applications 2026-09-05 → now()) | Pass |
| T9a | `update_application_status` by the job's company recruiter | Status, history with actor+note, 1 notification | All three written | Pass |
| T9b | Recruiter from another company | insufficient_privilege | `User 2 is not allowed to update application 11` | Pass |
| T9c | Candidate updates own status | insufficient_privilege | `User 17 is not allowed …` | Pass |
| T9d | Unknown status `hired` | invalid_parameter_value | `Unknown application status: hired` | Pass |
| T9e | Application 999999 | no_data_found | `Application 999999 does not exist` | Pass |
| T9f–g | Backwards transition via the function | Rejected; nothing saved | check_violation; status, history and notifications unchanged | Pass |
| T9h | Admin updates any application | Allowed | interviewed → offered | Pass |
| T10a | `generate_hiring_pipeline_report()` totals + company filter | 1 row per job; totals equal applications | 8 rows; totals match; Nimbus → 3 rows | Pass |
| T10b | from > to | invalid_parameter_value | `Invalid date range: from (2026-10-01) is after to (2026-09-01)` | Pass |
| T10c | Unknown company | no_data_found | `Company 424242 does not exist` | Pass |
| T11 | Views vs base tables | No double counting | Pipeline totals = applicant_count for every job; application view rows = applications; summary totals = applications and offers | Pass |
| T11b | Company with a job but 0 applications | Hidden by HAVING in `company_hiring_summary` | Hidden; still listed per job in `recruiter_pipeline_view` | Pass |
| T12 | Delete a candidate user (cascade) | Each affected job −1 | ML 4→3, Frontend 3→2 | Pass |
| T13 | `TRUNCATE applications CASCADE` | All counts 0 | All 0 | Pass |

| Other check | Result |
|---|---|
| `important_queries.sql` (16 queries) | All ran with exit code 0, no errors; outputs in advanced-features.md §4 |
| `transaction_demo.sql` | COMMIT persisted (count 3→4, then cleanup back to 3); failed transaction rolled back (0 demo rows, count 3); SAVEPOINT partial rollback worked; BEFORE = AFTER |
| Fresh `db:reset → db:migrate (13) → db:seed` | 16 applications, 31 history rows (no trigger duplicates) |
| applicant_count vs real count; latest history vs status; applications without history; history rows breaking the transition rules | 0 / 0 / 0 / 0 mismatches |
| `db:reset` leaves no objects behind | 0 tables, 0 views, 0 functions; `vector` extension kept |
| Re-running `db:seed` | jobs `updated_at` and `applicant_count` fingerprint unchanged |
| Stage 1 constraint tests after Stage 2 | 8/8 still rejected |
| `npm run build`; `GET /api/health` | Build passes; HTTP 200 |

## Stage 3 — Authentication and RBAC

Runner: Node's built-in `node:test` (no extra dependency). Details are in [authentication.md §9](authentication.md#9-tests).
```powershell
npm run test:unit
npm run build
npm run test:integration
```
Results recorded on 2026-10-09 against the production build (`next start`) and the seeded PostgreSQL database.

### Unit tests (`tests/unit/auth.test.js`): 20 pass, 0 fail
| Area | Tests |
|---|---|
| bcrypt | hash is `$2b$12$…` and never the plaintext; correct password accepted; wrong/empty rejected; random salt (two hashes differ); unknown user returns false; > 72 bytes refused |
| JWT | round-trip id/role; payload has only `sub, role, iss, aud, iat, exp`; edited payload rejected; wrong secret rejected; expired rejected; `alg: none` rejected; wrong audience/garbage/empty rejected; missing, short or placeholder secret throws without leaking the value |
| Cookie | httpOnly, SameSite=Lax, path `/`, 8 h; Secure only in production |
| Zod | email lower-cased, name trimmed; `role`/`isAdmin` fields rejected; password rules; bad email / missing fields |

### Integration tests (`tests/integration/auth.test.js`): 24 pass, 0 fail
| # | Test | Expected | Result |
|---|---|---|---|
| R1 | Register valid candidate | 201, safe user only, cookie HttpOnly + SameSite=Lax + Path=/ + Max-Age=28800 + Secure; DB hash `$2b$12$`, bcrypt-verifies, role candidate, candidates row created | Pass |
| R2 | Duplicate email, also in UPPER case | 409 `EMAIL_TAKEN` | Pass |
| R3 | Bad email / short password / no digit / 80-byte password / blank name / missing fields | 400 `VALIDATION_ERROR` with field errors | Pass |
| R4 | Body with `role: admin`, `role: recruiter`, `role: candidate`, `isAdmin: true` | 400, **no user row created** | Pass |
| R5 | Form-encoded body / malformed JSON / `Origin: https://evil.example` | 415 / 400 / 403 `CROSS_ORIGIN` | Pass |
| L1 | Seeded admin, recruiter, candidate with correct password | 200, correct role, cookie, no hash or "password" in body | Pass |
| L2 | Email in upper case | 200 | Pass |
| L3 | Wrong password vs unknown email | Both 401 `INVALID_CREDENTIALS`, identical bodies, no cookie | Pass |
| L4 | Missing password / bad email / missing email | 400 | Pass |
| L5 | `last_login_at` updated, `updated_at` unchanged | Migration 014 works | Pass |
| L6 | Disable an account (`is_active = false`) | Login 403 `ACCOUNT_DISABLED`; its existing token now gives 401 | Pass |
| M1 | `/me` without cookie | 401 `UNAUTHORIZED` | Pass |
| M2 | `/me` with valid cookie | 200, keys exactly `id, email, fullName, role`; no hash/password text | Pass |
| M3 | Garbage, tampered (role→admin), wrong-secret, `alg: none`, expired tokens | All 401 | Pass |
| M4 | Validly signed token claiming `admin` for a candidate id; token for a non-existent user | 401 on `/me` and `/api/demo/admin` (DB role is the source of truth) | Pass |
| O1 | Logout | 200; `tm_session=`, Max-Age=0, HttpOnly, Path=/; then `/me` 401 | Pass |
| O2 | Logout without a session | 200 | Pass |
| G1 | `/api/demo/{admin,recruiter,candidate}` anonymous | 401 ×3 | Pass |
| G2–4 | Each seeded role on the three demo routes | 200 on its own role, 403 `FORBIDDEN` on the others | Pass |
| W1 | `/api/demo/users/:id` | Own 200, other's 403 (candidate and recruiter), admin any 200, admin missing 404, `abc` 400, anonymous 401 | Pass |
| S1 | Every recorded response body and header | No JWT secret, no DB password, no bcrypt hash | Pass |
| S2 | Git-tracked/staged files | No JWT secret or DB password; `.env.local` not tracked | Pass |

Test accounts (`authtest.<run>.<n>@test.example`) were deleted afterwards: 0 leftover rows, 17 users as seeded.

### Negative control (proves the tests can fail)
`if (roles) assertRole(user, roles)` in `withAuth` was temporarily commented out and the app rebuilt. The integration run then gave **21 pass / 3 fail**: the three role-guard tests (G2–G4). The file was restored byte-for-byte, rebuilt, and the run went back to 24/24.

### Other Stage 3 checks
| Check | Result |
|---|---|
| Fresh `db:reset → db:migrate (14) → db:seed`, then integration tests | 24/24 |
| Stage 1 constraint tests | 8/8 still rejected |
| Stage 2 advanced tests | 27/27 PASS |
| `npm run build` | Passes; all `/api/*` routes dynamic (ƒ), `/login` and `/register` static, `/` partially prerendered |
| `GET /api/health` | HTTP 200, PostgreSQL 17.11, pgvector 0.8.7 |
| Page smoke test | `/` signed out shows the Sign in / Create account links; `/login` 2 inputs, `/register` 4 inputs, no role field; `/` with Meera's cookie shows "Signed in as … Meera Iyer" and Sign out; no hash in the HTML |
