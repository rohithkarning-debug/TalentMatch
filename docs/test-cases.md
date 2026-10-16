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
