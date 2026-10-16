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

## Stage 4 — Candidate module (profile, skills, resumes, job browsing)

Tests live in `tests/integration/candidate.test.js` and run against the production build (`next start` on port 3101) and the seeded database. `tests/fixtures/sample-resume.pdf` is a real PDF printed by a browser from `sample-resume.html` (embedded fonts, compressed streams; fictional person).
```powershell
npm run build
npm run test:integration
```
Results recorded on 2026-10-16: **41 pass, 0 fail** for the whole integration suite (24 Stage 3 auth tests + 17 candidate tests). Unit tests: 20 pass, 0 fail.

### Integration tests (`tests/integration/candidate.test.js`): 17 pass, 0 fail
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| C1 | Candidate endpoints anonymous / as recruiter | 401 / 403 | 401; 403 on profile, skills, resumes | Pass |
| C2 | Read and update own profile; body with `role: admin` | 200 with saved values; 400 | 200, name/location/experience saved; `role` rejected with 400 | Pass |
| C3 | Save profile with optional fields `null` or `""` | 200, stored as NULL | 200; location and headline returned as `null` | Pass |
| C4 | Add a catalogue skill, remove it; proficiency 8 | 201, 200; 400 | As expected; skill gone after delete | Pass |
| C5 | Add a new skill, then post the same skill again | 201 `created: true`, then 200 `created: false` with new values | 201 → 200; proficiency 2 → 5, years 0.5 → 3 | Pass |
| C6 | Delete another candidate's skill (Aditi's) | 404; her row kept | 404; row still in `candidate_skills` | Pass |
| C7 | Upload a .txt resume; another candidate deletes it; owner deletes it | 201; 404 with row kept; 200 | As expected | Pass |
| C8 | Upload the real PDF | 201, first resume is primary, text extracted | 201; `isPrimary: true`; `extracted_text` contains "Priya Natarajan" and "PostgreSQL" | Pass |
| C9 | 5 MB + 1 byte file; `.docx`; `image/png` named `.pdf`; text named `.pdf`; `%PDF-` header with garbage | 413 `FILE_SIZE`; 415 `FILE_TYPE`; 415; 400 `INVALID_PDF`; 400 `INVALID_PDF` | All as expected; 0 resume rows saved for that account | Pass |
| C10 | Set primary resume (`PATCH /api/candidate/resumes/:id`) | 200; exactly one primary | 200; only the new resume has `is_primary` | Pass |
| C10b | Same PATCH again / by another candidate / `isPrimary: false` / extra key / id `abc` | 200 / 404 / 400 / 400 / 404 | As expected; primary unchanged | Pass |
| C10c | Delete the primary resume | Newest remaining resume becomes primary | Promoted | Pass |
| C11 | 5 rounds × 8 parallel first uploads for a new candidate | All 201; exactly 1 primary of 8 | All 201; `{primaries: 1, total: 8}` every round | Pass |
| J1 | `/api/candidate/jobs` anonymous / recruiter / admin | 401 / 403 / 403 | As expected | Pass |
| J2 | No filters | Exactly the open jobs; no draft/closed job | The 6 open jobs; job 4 (draft) and 7 (closed) absent | Pass |
| J3 | Keyword `devops`, `python` (skill), no-match, `%`, `' OR 1=1 --` | Matches in title/description/company/skill; 0; 0; 0 | As expected (wildcards and SQL text treated as plain text) | Pass |
| J4 | `location=pune`, `employmentType=internship`, `experience=1.5`, all combined, all empty | Same ids as the equivalent SQL filter on open jobs; empty = no filter | Ids match exactly in every case | Pass |
| J5 | `employmentType=permanent`, `experience=-1`, `experience=abc`, `status=draft`, 101-char keyword | 400 | 400 for all five | Pass |
| J6 | `hasApplied` for Aditi | True exactly for her applications to open jobs | Matches `applications` table | Pass |

Test accounts (`candidate.module.<run>…@test.example`) and their uploaded files are deleted afterwards: 0 leftover test users, 0 files in `uploads/resumes`, 17 users as seeded.

### Bugs found and fixed in this stage (with evidence)
| Bug | How it showed up | Fix | Evidence after the fix |
|---|---|---|---|
| Every PDF upload failed in the production build | Real PDF → 400 `RESUME_PARSE_FAILED`. Hidden causes: (1) bundled pdfjs could not find `.next/server/chunks/pdf.worker.mjs`; (2) `pdf.destroy()` does not exist in pdfjs 6 | `serverExternalPackages: ["pdfjs-dist"]`; clean up with `loadingTask.destroy()`; specific 400s for damaged / password-protected / image-only PDFs, logged 500 otherwise | C8 passes; each cause was confirmed separately by rebuilding with only the other fix |
| Two parallel first uploads could both become primary | Unique index `resumes_one_primary_per_candidate` rejected all but one: 409 `CONFLICT` | Lock the candidate row with `SELECT … FOR NO KEY UPDATE` at the start of the upload/delete/set-primary transaction | **Negative control:** with the lock removed and the app rebuilt, C11 failed in round 2 (7 of 8 uploads got 409). With the lock: passes |
| Saving a profile with an empty optional field crashed the page | `null.trim()` in `saveProfile`; the Save button stayed disabled | `(value ?? "").trim()`; `setBusy(false)` in `finally` | Manual check below |
| Form not reset after a resume upload | `e.currentTarget` is `null` after `await` | Keep the form element in a variable first | Manual check below |
| Re-adding an existing skill returned 201 | Upsert always answered "created" | `RETURNING (xmax = 0) AS inserted` → 201 or 200 | C5 |

### Manual UI check (real browser)
Headless Chrome driven over the DevTools protocol against `next start`, logged in as seeded candidate `divya.krishnan@mail.example`. Her profile and resumes were restored afterwards.
| Step | Result |
|---|---|
| Log in | Home page shows "Signed in as Divya Krishnan · Candidate" and the dashboard link |
| Clear phone, location, headline, education → Save | "Profile saved successfully."; Save button enabled again; database columns are NULL |
| Upload `sample-resume.pdf` | "Resume uploaded successfully."; file input cleared; listed with size 51.1 KB; 581 characters extracted |
| Set as primary | "Primary resume updated."; only `sample-resume.pdf` has the Primary badge; database agrees |
| Browse jobs | 6 open jobs |
| Keyword `python` → + Bengaluru → + Internship | 3 → 3 → 1 (NLP Research Intern) |
| Experience 1.5 only | 3 (NLP Research Intern, Frontend Developer, Data Analyst) |
| Keyword with no match | 0 and "No open jobs match these filters." |
| Browser console | No errors or exceptions |

### Other Stage 4 checks
| Check | Result |
|---|---|
| `npm run build` | Passes; `/api/candidate/jobs` dynamic (ƒ), `/candidate/jobs` partially prerendered. One Turbopack warning ("Dynamic filesystem access causes tracing of the whole project") also appears in builds without this stage's config change |
| `important_queries.sql` (now 19 queries, Q17–Q19 added for the candidate module) | Whole file runs with exit code 0 |

## Stage 5 — Semantic matching (pgvector)

Design: [vector-design.md](vector-design.md). Tests: `tests/unit/embeddings.test.js`, `tests/unit/recruiter-validation.test.js`, `tests/integration/matching.test.js` (production build on port 3102, real model, real database).
```powershell
npm run db:embed
npm run test:unit
npm run build
npm run test:integration
```
Results recorded on 2026-10-16: unit **38 pass, 0 fail** (20 auth + 15 embeddings + 3 matches-query validation). Integration **54 pass, 0 fail** (24 auth + 17 candidate + 13 matching). No score in any test is hard-coded; the tests compare orderings and recompute cosine similarity in SQL.

### Unit tests (no server, no database)
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| E1 | `chunkWords`: short text; 50 words with max 20 / overlap 5 | 1 chunk; every chunk ≤ 20 tokens, next chunk starts with the previous chunk's last 5 words, no word lost | As expected | Pass |
| E2 | Words with several word pieces; 1000 words with `maxChunks: 3`; overlap ≥ max | Never over the limit, words not split; 3 chunks + `truncated: true`; error | As expected | Pass |
| E3 | Weighted mean of `[1,0]×3` and `[0,1]×1`; opposite vectors | Unit length, ratio 3:1; "zero vector" error | As expected | Pass |
| E4 | `toPgVector` with 384 numbers / 3 numbers / a NaN | `[…]` literal / error / error | As expected | Pass |
| E5 | Whitespace-only differences; job text builder | Same SHA-256; `"ML Engineer. Train models.. Required skills: PyTorch, Python."` | As expected | Pass |
| E6 | `tryEmbedResume` with an embedder that throws | Returns `false`, no exception, 0 database queries | As expected | Pass |
| E7 | Real model: one sentence | 384 dims, length 1 (±1e-6), model name stored, 1 chunk, 64-hex hash | As expected | Pass |
| E8 | Real model: same text twice; ~840-word text | Dot product > 0.9999; ≥ 3 chunks, still unit length | As expected | Pass |
| E9 | Real model: ML job vs ML sentence vs React sentence | ML pair more similar than ML–React pair | As expected | Pass |
| Q1 | Matches query schema: `{}`; `applicantsOnly=true&limit=5`; `yes`, `0`, `51`, `2.5`, `abc`, unknown `sort` | `{false, 10}`; `{true, 5}`; all rejected | As expected | Pass |

### Ranking sanity (`rank_candidates_for_job`, printed by the test)
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| V1 | ML Engineer job | All ML/data candidates (Aditi, Rohan, Divya, Ishita, Farhan) above all frontend-only candidates (Sneha, Vikram) | ML/data at #1, #2, #3, #4, #9; Vikram #10 (0.2748), Sneha #12 (0.2438) | Pass |
| V2 | Frontend Developer job | Sneha and Vikram above all five ML/data candidates | Sneha #1 (0.7552), Vikram #2 (0.7460); best ML/data candidate is Aditi at #8 (0.2619) | Pass |
| V3 | Scores = direct `1 - (resume <=> job)` computed in SQL; sorted descending | Difference ≤ 0.00005 (rounding) for every candidate | As expected for all 12 | Pass |
| V4 | `p_applicants_only = TRUE` | Exactly the job's applicants with an embedded primary resume, all `has_applied` | Aditi, Rohan, Divya, Aman (the 4 seeded applicants) | Pass |

Full ranked lists with scores: [vector-design.md §7](vector-design.md#real-results-seeded-data).

### Matches API (`GET /api/recruiter/jobs/:jobId/matches`)
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| M1 | Meera (Nimbus) → Nimbus ML job, `limit=5` | 200; 5 matches identical (ids and scores) to the SQL function; model name in response | As expected | Pass |
| M2 | Arjun (Nimbus, not the job's poster), `applicantsOnly=true` | 200; every match `hasApplied` | As expected | Pass |
| M3 | Kavya (Kestrel) → Nimbus job | 403 `FORBIDDEN` | 403 | Pass |
| M4 | Candidate Aditi / admin | 403 / 403 | 403 / 403 | Pass |
| M5 | No cookie | 401 | 401 | Pass |
| M6 | Job ids `999999999`, `abc`, `-1` | 404 | 404 ×3 | Pass |
| M7 | `limit=0`, `limit=51`, `applicantsOnly=yes`, `sort=asc` | 400 | 400 ×4 | Pass |
| M8 | New job inserted without embedding → embed with `embedJob` → delete job | 404 `NOT_EMBEDDED` → 200 with 3 matches → embedding row gone (cascade) | As expected | Pass |

### Embedding on upload
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| U1 | Upload a .txt resume → list → delete its embedding row (simulated failure) → `embedPending()` → delete resume | 201 `isEmbedded: true`, row with model name, 1 chunk, 384 dims → list says embedded → list says `isEmbedded: false` → re-embedded → embedding row gone (cascade) | As expected | Pass |

### Other Stage 5 checks
| Check | Result |
|---|---|
| `npm run db:migrate` | `015_rank_candidates_for_job.sql` applied; 14 skipped |
| `npm run db:embed` (first / second run) | 12 resumes + 8 jobs embedded in 2.0 s / 0 embedded in 0.1 s (idempotent) |
| Stored vectors | `vector_norm = 1.000000`, `vector_dims = 384`, `model_name = sentence-transformers/all-MiniLM-L6-v2` |
| Function input errors | `rank_candidates_for_job(999999)` → "Job 999999 does not exist"; limit 0 → "Limit must be between 1 and 100" |
| EXPLAIN ANALYZE | Seq scan + sort on 12 rows (exact, 0.13 ms); with `enable_seqscan = off`, `Index Scan using resume_embeddings_embedding_hnsw_idx`, same top 5. Details in [vector-design.md §8](vector-design.md#8-is-the-hnsw-index-used-explain-analyze) |
| `important_queries.sql` (now 22 queries, Q20–Q22 added) | Whole file runs with `ON_ERROR_STOP=1`, exit code 0 |
| Test data cleanup | After the run: 12 resumes / 12 resume embeddings / 8 jobs / 8 job embeddings, 0 `@test.example` users |
| `npm run build` | Passes; `/api/recruiter/jobs/[jobId]/matches` is dynamic (ƒ). The existing Turbopack warning from `src/lib/candidate/resumes.js:76` is unchanged |

## Stage 6 — Recruiter module and applications

Tests: `tests/unit/recruiter-validation.test.js` (job and status schemas), `tests/integration/recruiter.test.js` (production build on port 3103, real database, real embedding model). New migrations: `016_compute_match_score.sql`, `017_applications_updated_at_ignore_match_score.sql`.
```powershell
npm run db:migrate
npm run db:embed
npm run test:unit
npm run build
npm run test:integration
```
Results recorded on 2026-10-16: unit **45 pass, 0 fail** (20 auth + 15 embeddings + 10 recruiter validation). Integration **74 pass, 0 fail** (24 auth + 17 candidate + 13 matching + 20 recruiter). No score is hard-coded; each one is recomputed in SQL.

### Full flow
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| R1 | Meera posts an open job with 2 required + 1 nice-to-have skill | 201; company = Nimbus, recruiter = Meera, `applicant_count` 0; `job_embeddings` row (MiniLM, 384 dims) | As expected | Pass |
| R2 | New candidate uploads a .txt resume and applies with it | 201 `applied`; `match_score` = stored value = `1 - (resume <=> job)` within 0.00005; `applicant_count` +1 (trigger) | e.g. stored 0.8106, recomputed 0.810638…; count 0 → 1 | Pass |
| R3 | Rows written by the apply transaction | History `(NULL → applied, changed_by = candidate)`; 1 `application_submitted` notification for Meera | As expected | Pass |
| R4 | Meera shortlists via `PATCH /api/recruiter/applications/:id` | 200; trigger-written history `applied → shortlisted`, `changed_by` Meera, note kept; candidate gets a `status_changed` notification | As expected | Pass |
| R5 | Recruiter applicants list, My Jobs, matches API, candidate My Applications | Same score everywhere; matched `[Python]` of required `[NLP, Python]`; `applicantCount` 1, `shortlisted` 1; history `[applied, shortlisted]` | As expected | Pass |

### Transaction rollback
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| T1 | `applyToJob()` with a notification whose title is blank (fails **after** the application INSERT) | Error `23514 notifications_title_not_blank_check`; 0 application rows, 0 history rows, `applicant_count` unchanged; the same application then succeeds (+1) | As expected | Pass |
| T1-neg | Negative control: the same statements without BEGIN/ROLLBACK | Shows the half-done state the test would catch | 1 application row left, count 1 → 2 (then cleaned up) | As expected |

### Invalid transitions (database-enforced)
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| S1 | API `applied → offered` (skipping stages) | 409 `INVALID_TRANSITION`, message `… applied -> offered …` | As expected | Pass |
| S2 | Reject, then `rejected → offered` by direct SQL `UPDATE`, by `update_application_status()` and by the API | SQL error `23514` "Invalid application status transition: rejected -> offered" ×2; API 409 with the DB hint "… rejected is final."; status and history count unchanged | As expected | Pass |

### Permissions and application rules
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| P1 | Kavya (Kestrel) on a Nimbus job: GET, PATCH title, PATCH status, DELETE, applicants list | 403 ×5; job unchanged; not in Kavya's My Jobs | As expected | Pass |
| P2 | Create a job with `companyId` / `recruiterId` in the body | 400 (strict schema) | 400 | Pass |
| P3 | Same candidate applies twice | 201, then 409 `ALREADY_APPLIED` (UNIQUE constraint); count unchanged | As expected | Pass |
| P4 | Candidate PATCHes an application status / no cookie / Kavya | 403 / 401 / 403; status still `applied` | As expected | Pass |
| P5 | Apply to a **closed** job / a **draft** job | 409 `JOB_NOT_OPEN` / 404; count unchanged; draft job page 404 for candidates; 0 rows | As expected | Pass |
| P6 | Apply with another candidate's resume | 404 | 404 | Pass |

### Job CRUD
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| J1 | Edit title + skills; then status-only change | Re-embedded (`source_hash` changes); status change keeps the hash | As expected | Pass |
| J2 | Description of 9 chars / `closesAt` 2020-01-01 / unknown skill id | 400 field error / 400 `jobs_closes_after_posted_check` / 400 `job_skills_skill_fkey`; nothing saved (rolled back) | As expected | Pass |
| J3 | Delete a draft job with no applications; delete a job with applications | 200, job + embedding + skills gone (CASCADE) / 409 `JOB_HAS_APPLICATIONS` (FK `ON DELETE RESTRICT`) | As expected | Pass |

### Skill gap (`job_skills EXCEPT candidate_skills`)
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| G1 | Seeded Aman, ML Engineer job | have: Python (level 2 of 4, below level); missing: NLP, PyTorch | As expected | Pass |
| G2 | Seeded Aditi, ML Engineer job | have: NLP, PyTorch, Python (all at level); missing: none | As expected | Pass |
| G3 | have ∪ missing vs the job's required skills; API `GET /api/candidate/jobs/:id` | Exactly the required set; API returns identical lists and Aman's application (`rejected`) | As expected | Pass |

### Unit tests (validation)
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| V1 | `jobCreateSchema` defaults; skill defaults | draft, onsite, full_time, INR, 1 opening, 0 yrs, no salary, `[]`; `isRequired` true, `minProficiency` 3 | As expected | Pass |
| V2 | Explicit `salaryMin: null` | Stays `null` (regression test: it was coerced to 0, found in the browser check; fails without the fix) | As expected | Pass |
| V3 | 11 bad inputs (short description, blank title, bad status, max < min salary, 0 openings, 1.25 years, bad date, duplicate skill, level 6, `companyId`, `applicantCount`) | All rejected | As expected | Pass |
| V4 | `jobUpdateSchema` status-only / `{}` / `recruiterId`; `applicationStatusSchema` five statuses / `hired` / `changedBy` | ok / rejected / rejected; ok / rejected / rejected | As expected | Pass |

### Browser check (real headless Chrome, production build, 2026-10-16)
A scratch script drove Chrome over the DevTools protocol, typing into the real forms, clicking, and uploading a file. 12/12 checks passed:
Meera logs in → My Jobs with applicant counts → posts a job with Python + NLP through the form → job detail says "embedded", salary "not disclosed" → a new candidate registers, uploads a .txt resume, adds Python → job page skill gap shows **have Python (1/2), missing NLP (1/2)** → Apply → "Match score: 0.7461" → My Applications shows the score and "Application submitted" → Meera's My Jobs shows **1** applicant → Ranked applicants shows 0.7461 → shortlist with a note → history shows the note → choose **offered** → red alert "Invalid application status transition: shortlisted -> offered (application 42)" + the allowed moves → Search all candidates table (13 ranked candidates, matched/required skill chips) → Close job. The UI score 0.7461 was checked in SQL: `1 - (a <=> b)` = 0.746140…, `applicant_count` 1.

**Bug found by the browser check and fixed:** an empty salary was saved as ₹0 because `z.coerce.number()` turned `null` into 0 (commit "Fix empty job salary being saved as 0 instead of NULL"; regression test V2).

### Other Stage 6 checks
| Check | Result |
|---|---|
| `npm run db:migrate` | 016 and 017 applied; 15 skipped |
| `npm run db:embed` (first / second run) | 16 seeded application scores filled in / 0 (idempotent); `applications.updated_at` checksum identical before and after (migration 017) |
| `important_queries.sql` (now 26 queries) | Whole file runs with `ON_ERROR_STOP=1`, exit code 0; Q23 shows count 3 → 4 inside the transaction, 3 after ROLLBACK; Q25 max difference 0.00004318 |
| Test data cleanup | After the runs: 8 jobs, 16 applications, 0 `@test.example` users |
| `npm run build` | Passes; all new API routes dynamic (ƒ), new pages partial prerender (◐). The existing Turbopack warning from `src/lib/candidate/resumes.js:76` is unchanged |

## Stage 7 — Interviews, offers and notifications

Tests: `tests/unit/pipeline-validation.test.js` (request schemas), `tests/integration/pipeline.test.js` (production build on port 3104, real database). New migrations: `018_interview_offer_rules.sql`, `019_freeze_final_interviews_offers.sql`.
```powershell
npm run db:migrate
npm run test:unit
npm run build
npm run test:integration
```
Results recorded on 2026-10-16: unit **58 pass, 0 fail** (45 earlier + 13 pipeline validation). Integration **102 pass, 0 fail** (74 earlier + 28 pipeline). Every "what changed" check reads the database directly, not only the API response.

### Interviews
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| I1 | Meera schedules the first interview for a shortlisted application | 201, round 1 `scheduled`, application `interviewed`; trigger history row `shortlisted → interviewed`, `changed_by` Meera, note "Interview round 1 scheduled"; candidate gets `status_changed` + `interview_scheduled`; `interviewer_id` = Meera | As expected | Pass |
| I2 | Second interview (onsite, 90 min) | round_no 2; status and history count unchanged | As expected | Pass |
| I3 | Candidate `GET /api/candidate/interviews` | Both rounds upcoming; no `rating` / `feedback` keys; another candidate sees `[]` | As expected | Pass |
| I4 | Reschedule, cancel, then reschedule and cancel again | 200, 200, then **409** `RULE_VIOLATION` "… is already cancelled" ×2; exactly 2 `interview_updated` notifications (no duplicate) | As expected | Pass |
| I5 | Mark completed with rating 5 + feedback | 200, `completed`, rating 5 | As expected | Pass |
| I6 | Rating 0 and 6 (API); `rating = 6` by direct SQL | 400 ×2; SQL `23514 interviews_rating_check`; row still `scheduled`, rating NULL | As expected | Pass |
| I7 | Interview 2 hours in the past (API); past INSERT and past reschedule by direct SQL | 400 "Interview must be scheduled in the future"; SQL errors from `trg_interviews_guard` (insert and reschedule); 0 rows | As expected | Pass |
| I8 | Video without a link (API); onsite without location (SQL) | 400; `interviews_location_required_check` | As expected | Pass |
| I9 | Schedule for an `applied` application | 409 "… only … shortlisted or interviewed applications"; nothing changed (status, history, notifications, interviews) | As expected | Pass |

### Offers (transaction)
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| O1 | Make an offer on the interviewed application | 201 `pending` ₹22,00,000 INR; application `offered`; history `interviewed → offered` by Meera ("Offer made"); notifications +2 (`status_changed`, `offer_made`); 1 offer row | As expected | Pass |
| O2 | **Forced rollback:** second offer for the same application | 409 `OFFER_EXISTS` (UNIQUE `offers_application_id_key`); status, history, notifications, offers all unchanged; the stored salary is still the first one | As expected | Pass |
| O3 | **Forced rollback after the status change:** an `interviewed` application that already has an offer row | 409; the status change, its history row and its notification are rolled back (snapshot identical) | As expected | Pass |
| O4 | **Forced rollback at the last step:** `makeOffer()` with a blank notification title | `23514 notifications_title_not_blank_check`; no offer, status `interviewed`, no history row, no notification | As expected | Pass |
| O5 | `offered` without an offer: `update_application_status()` by SQL and the status PATCH API | SQL error at COMMIT "cannot be offered without a pending offer" (deferred trigger); API 409 `RULE_VIOLATION`; nothing changed | As expected | Pass |
| O6 | Offer on an `applied` application | 409 `INVALID_TRANSITION` "… applied -> offered …"; nothing saved | As expected | Pass |
| O7 | Expiry yesterday (API); joining date today (SQL) | 400; SQL "Joining date must be after today" (`trg_offers_guard`) | As expected | Pass |
| O8 | Another candidate responds to the offer; a recruiter calls the candidate route | **404** (offer not revealed) / 403; offer still `pending`; other candidate's offer list `[]` | As expected | Pass |
| O9 | Candidate accepts | 200 `accepted`, `responded_at` set; Meera gets `offer_responded`; application stays `offered` | As expected | Pass |
| O10 | Decline after accepting; accept again | 409 "… already accepted" ×2; no second recruiter notification | As expected | Pass |
| O11 | **Expired offer:** `expires_on` set to yesterday (simulating time passing), then accept | List shows `canRespond false, isExpired true`; 409 "… expired on …"; offer still `pending`, `responded_at` NULL, no notification. After extending to today, decline → 200 and the recruiter gets "Offer declined: …" | As expected | Pass |
| O12 | Withdraw (Kavya, then Meera) | Kavya 403; Meera 200 `withdrawn`, application `offered → rejected`, candidate gets `status_changed` + `offer_withdrawn` | As expected | Pass |
| O13 | Withdraw again; withdraw an accepted offer | 409 "… already withdrawn" (no new notification) / 409 "… already accepted" | As expected | Pass |
| O14 | Arjun posts a job, Meera makes the offer, candidate accepts | Exactly Meera and Arjun get `offer_responded` | As expected | Pass |

### Permissions
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| P1 | Kavya (Kestrel) schedules / cancels / makes an offer on Nimbus applications | 403 ×3; nothing changed; Kavya's interview and offer lists contain none of them; Meera's upcoming list does | As expected | Pass |
| P2 | Candidate calls schedule, interview PATCH, make offer, recruiter interview list | 403 ×4; no cookie → 401; unknown application → 404 | As expected | Pass |

### Notifications inbox
| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| N1 | Candidate lists notifications | Every returned id belongs to the candidate (checked in SQL); `unreadCount` = SQL count; another candidate's list shares no ids; `?userId=1` → 400 | As expected | Pass |
| N2 | Another candidate and a recruiter mark the candidate's notification read; then the owner | 404 ×2 and `is_read` still false; owner 200, unread count −1 | As expected | Pass |
| N3 | Mark all as read | `updated > 0`, unread 0; another user's unread count unchanged; no session → 401 | As expected | Pass |

### Unit tests (`tests/unit/pipeline-validation.test.js`, 13)
| # | Test | Result |
|---|---|---|
| U1 | `todayInIndia()` returns the Asia/Kolkata date (20:00 UTC on 15 Oct → 16 Oct) | Pass |
| U2 | Interview schedule: defaults; phone without location; past time rejected; 8 bad inputs (no link, onsite without address, link without http(s), mode `zoom`, 10 / 481 minutes, timestamp without offset, extra `applicationStatus`) | Pass |
| U3 | Interview update: three actions accepted; rating 0/6/−1/4.5/"five", blank feedback, past reschedule, unknown action, `cancel` with `rating` rejected | Pass |
| U4 | Offer: valid offer, coercion and INR default; expiry today allowed; zero salary, joining today, past expiry, expiry after joining, missing expiry, bad currency, extra `status` rejected | Pass |
| U5 | Offer response, notification PATCH and list query schemas (only `accept`/`decline`, only `isRead: true`, no `userId`) | Pass |

### Bugs found and fixed in this stage (with evidence)
| Bug | Found by | Fix |
|---|---|---|
| Withdrawing an offer twice returned 200 and notified the candidate again (same for cancelling an interview twice or accepting twice): the 018 guards only rejected a *change* of status | Integration test O13: `expected 409, actual 200` | Migration 019: completed/cancelled interviews and accepted/declined/withdrawn offers are frozen (commit "Freeze final interviews and offers (migration 019)") |
| When a recruiter made an offer on a colleague's job, only the job poster was told the candidate accepted | Browser check: Meera's inbox never showed "accepted" (it went to Arjun, who posted the job) | Notify the poster **and** the offer maker (from the `→ offered` history row); test O14 |

### Browser check (real headless Chrome, production build, 2026-10-16)
A scratch script drove Chrome over the DevTools protocol (time zone Asia/Kolkata), typing into the real forms and clicking the real buttons. **17/17 checks passed.** Setup: a fictional candidate "Nikhil Arora" registers, uploads a resume and applies to the seeded Data Analyst job (via the API, as in Stage 6). Then in the browser:
Meera logs in → shortlists Nikhil with the status dropdown → "Schedule interview" → a past time is refused by the form ("Interview must be scheduled in the future") → tomorrow 11:00, video link → the row shows "Round 1 · Scheduled", status **Interviewed** and a "Make offer" button (DB: status `interviewed`, last history row `interviewed`, candidate notifications `status_changed, status_changed, interview_scheduled`) → Interviews page lists the seeded rounds and flags the seeded 14 Oct round "The time has passed" → mark completed 4/5 with feedback → "Make offer" ₹14,50,000, joining +45 days, respond by +10 days → row shows "Offer ₹14,50,000 · Pending", status **Offered** → choosing **offered** for Ishita (shortlisted) shows "Invalid application status transition: shortlisted -> offered" → Offers page lists the seeded Rohan offer and the new one → Nikhil logs in: inbox "5 unread", mark one read → "4 unread" → My interviews shows round 1 under Past **without** the recruiter's feedback → My offers → Accept (confirmation dialog) → "Offer accepted. The recruiter has been notified." (DB: `accepted`, `responded_at` set) → Meera's inbox shows "Nikhil Arora accepted your offer for Data Analyst." → seeded Rohan's pending offer with Accept/Decline and seeded Aditi's interviews render.
Afterwards the script deleted the test candidate (cascade) and the recruiter notifications it created: 0 test users, Data Analyst `applicant_count` back to 3, 6 notifications (the seeded ones).

Screenshots: `docs/screenshots/stage7/` (recruiter-schedule-interview-past-error, recruiter-interviews, recruiter-make-offer-form, recruiter-job-detail-offer, recruiter-offers, recruiter-notifications, candidate-notifications, candidate-offers-pending, candidate-offer-accepted, candidate-offers-seeded, candidate-interviews-seeded).

### Other Stage 7 checks
| Check | Result |
|---|---|
| `npm run db:migrate` | 018 and 019 applied; 17 skipped |
| `npm run db:seed` after 018 | Still runs (the seeded past interviews and the old offer are imported with `import_mode`) |
| `important_queries.sql` (now 32 queries) | Whole file runs with `ON_ERROR_STOP`, exit code 0. Q27: `interviewed → offered` inside the transaction, `interviewed` and 0 offers after ROLLBACK. Q28: before `status=interviewed history=3 notifications=1`, inside `offered / 4 / 2`, after the UNIQUE error `interviewed / 3 / 1`. Q29: the deferred check fires with `SET CONSTRAINTS … IMMEDIATE` |
| Test data cleanup | After all runs: 8 jobs, 16 applications, 7 interviews, 1 offer, 6 notifications (the seed), 0 `@test.example` users |
| `npm run build` | Passes; 12 new API routes dynamic (ƒ), 5 new pages partial prerender (◐). Only the existing Turbopack warning (`src/lib/candidate/resumes.js:76`) |
