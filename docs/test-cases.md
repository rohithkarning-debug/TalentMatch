# TalentMatch — Test Cases and Results (final, Stage 9)

Every row marked **Pass** below was run on **2026-10-16** during Stage 9. The suites in the summary (build, unit, integration, SQL scripts) and the clean-clone check were run on the final commit, on a database rebuilt from scratch (`db:reset → db:migrate → db:seed → db:embed`). The negative controls (9-18, 9-19, 9-28, 9-41) temporarily break one fix on purpose, so each was run while that fix was being added and then the fix was restored. Nothing is marked Pass from an earlier stage. Checks from earlier stages that were *not* repeated are listed separately in [§ Not re-run in Stage 9](#not-re-run-in-stage-9) and are not counted.

**Environment:** Windows 11, Node.js 22.19.0, Next.js 16.4.0 production build (`next start`), PostgreSQL 17.11 + pgvector 0.8.7 in Docker (port 5433), model `sentence-transformers/all-MiniLM-L6-v2`.

**"As expected"** in the Actual column means every assertion in that test passed. Where the run printed values, they are quoted.

## Summary of the final run

| Suite | Command | Real output | Result |
|---|---|---|---|
| Build | `npm run build` | exit 0, "Compiled successfully"; 1 Turbopack warning ("Dynamic filesystem access…", `src/app/api/candidate/resumes/[resumeId]/route.js`), present since Stage 4 | Pass |
| Unit tests | `npm run test:unit` | `# tests 74  # suites 22  # pass 74  # fail 0` | Pass |
| Integration tests | `npm run test:integration` | `# tests 145  # suites 35  # pass 145  # fail 0` (67.1 s) | Pass |
| Stage 1 SQL | `db/tests/stage1_constraint_tests.sql` | 8 of 8 invalid writes rejected, each rolled back | Pass |
| Stage 2 SQL | `db/tests/stage2_advanced_tests.sql` | 27 PASS lines (T1–T13), `=== All Stage 2 tests passed …` | Pass |
| Important queries | `psql -v ON_ERROR_STOP=1 < db/queries/important_queries.sql` | Q1–Q41 ran, exit code 0 | Pass |
| Transaction demo | `db/demos/transaction_demo.sql` | AFTER equals BEFORE (Data Analyst `applicant_count` 3 and 3) | Pass |
| Clean setup | Fresh `git clone` of the final commit, README only | All steps worked (9-25); 3 README gaps had been fixed earlier in the stage | Pass |

```powershell
npm run db:reset -- --yes; npm run db:migrate; npm run db:seed; npm run db:embed
npm run build
npm run test:unit
npm run test:integration
Get-Content db/tests/stage1_constraint_tests.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
Get-Content db/tests/stage2_advanced_tests.sql   | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
```

Test data clean-up after the run: 0 `@test.example` users; 18 applications, 3 offers (the seed).

---

## Stage 1 — Schema, constraints, migrations

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 1-01 | Schema | Duplicate email | SQL INSERT a user with `aditi.sharma@mail.example` | Rejected by UNIQUE | `duplicate key value violates unique constraint "users_email_key"` | Pass |
| 1-02 | Schema | Unknown application status | SQL UPDATE status to `hired` | Rejected | `Invalid application status transition: applied -> hired`. Since Stage 2 the BEFORE trigger refuses it before the CHECK `applications_status_check` runs; the CHECK is still there as a second line | Pass |
| 1-03 | Schema | Salary range | INSERT job with min 1,500,000 > max 900,000 | Rejected by CHECK | `violates check constraint "jobs_salary_range_check"` | Pass |
| 1-04 | Schema | Duplicate application | INSERT the same (job, candidate) twice | Rejected by UNIQUE | `violates unique constraint "applications_job_id_candidate_id_key"` | Pass |
| 1-05 | Schema | FK to missing job | INSERT application for job 999999 | Rejected by FK | `violates foreign key constraint "applications_job_fkey"` | Pass |
| 1-06 | Schema | Candidate profile for a recruiter | INSERT `candidates` row for user 2 | Rejected by composite FK (user_id, role) | `violates foreign key constraint "candidates_user_fkey"` | Pass |
| 1-07 | Schema | Plaintext password | INSERT user with hash `password123` | Rejected by CHECK | `violates check constraint "users_password_hash_bcrypt_check"` | Pass |
| 1-08 | Schema | Delete company in use | DELETE company 3 | Rejected (ON DELETE RESTRICT) | `violates foreign key constraint "recruiters_company_fkey"` | Pass |
| 1-09 | Migrations | Migrate an empty database | `db:reset -- --yes`, then `db:migrate` | All files applied in order | `Done: 22 applied, 0 already up to date.` | Pass |
| 1-10 | Migrations | Migrate again | `db:migrate` | Nothing re-applied (SHA-256 tracked) | `Done: 0 applied, 22 already up to date.` | Pass |
| 1-11 | Seed | Seed twice | `db:seed` twice | Same row counts (idempotent) | Both runs: users 17, applications 18, history 40, interviews 9, offers 3, notifications 10 | Pass |
| 1-12 | Schema | Catalogue counts | SQL on `information_schema` / `pg_catalog` | 16 domain tables, 3 views, HNSW indexes on both embedding tables | 16 tables, 3 views, 16 PK, 22 FK, 8 UNIQUE, 57 CHECK, 46 indexes (2 HNSW, 3 partial), 18 triggers | Pass |

## Stage 2 — Triggers, functions, views, queries, transactions

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 2-01 | Triggers | T1 insert application | INSERT application | `applicant_count` +1; history `NULL → applied` | `applicant_count 3 -> 4, history (NULL -> applied) by candidate 9` | Pass |
| 2-02 | Triggers | T2 delete application | DELETE it | `applicant_count` −1 | `4 -> 3` | Pass |
| 2-03 | Triggers | T3 move application between jobs | UPDATE job_id there and back | −1/+1 then back | `old job 2 -> 1 -> 2, new job 3 -> 4 -> 3` | Pass |
| 2-04 | Triggers | T4 status change with actor + note | `set_config` actor/note, UPDATE status | History row with actor and note | `applied -> shortlisted by user 3, note "Good SQL test score"` | Pass |
| 2-05 | Triggers | T5 invalid transitions | 5 illegal moves | All rejected, no history | `5/5 invalid transitions rejected, no history rows written` | Pass |
| 2-06 | Triggers | T6 full path + no-op | applied→…→rejected, then same status | 5 history rows; no-op not logged | `5 history rows for the full path; same-status update ignored` | Pass |
| 2-07 | Triggers | T7 insert as `offered` | INSERT with status offered | Rejected | `A new application must start with status 'applied' (got offered)` | Pass |
| 2-08 | Triggers | T8a–e `updated_at` | Real edit / no-op / counter change / status change / profile edit | Refreshed / unchanged / unchanged / refreshed / refreshed | 5/5 PASS lines (e.g. `jobs.updated_at 2026-01-01 -> 2026-10-16 …`) | Pass |
| 2-09 | Functions | T9a `update_application_status` | Called by the company's recruiter | Status, history, 1 notification | `status=interviewed history=(shortlisted -> interviewed by 4, "Technical round cleared") + 1 notification` | Pass |
| 2-10 | Functions | T9b–c wrong actor | Other company's recruiter; the candidate | insufficient_privilege | `User 2 is not allowed…`, `User 17 is not allowed…` | Pass |
| 2-11 | Functions | T9d–e bad input | Status `hired`; application 999999 | Errors | `Unknown application status: hired`; `Application 999999 does not exist` | Pass |
| 2-12 | Functions | T9f–h | Backwards move; nothing saved; admin override | Rejected / unchanged / allowed | 3/3 PASS lines | Pass |
| 2-13 | Functions | T10a–c `generate_hiring_pipeline_report` | All companies, Nimbus only, from > to, unknown company | 1 row per job; errors for bad input | `8 job rows, 19 applications total; Nimbus filter -> 3 rows`; `Invalid date range…`; `Company 424242 does not exist` | Pass |
| 2-14 | Views | T11, T11b | Compare 3 views with base tables; company with 0 applications | Equal; hidden by HAVING | `all three views consistent with base tables`; hidden in summary, visible per job | Pass |
| 2-15 | Triggers | T12 cascade delete | DELETE a candidate user | Each affected job −1 | `ML Engineer 4 -> 3, Frontend 3 -> 2` | Pass |
| 2-16 | Triggers | T13 TRUNCATE | `TRUNCATE applications CASCADE` (own transaction since Stage 9) | Every count 0 | `all applicant_count values are 0 after TRUNCATE` | Pass |
| 2-17 | Queries | Important queries | Whole file with `ON_ERROR_STOP=1` | Q1–Q41 run, no error | Exit code 0; Q28 and Q40 print their deliberate, caught errors as NOTICEs | Pass |
| 2-18 | Transactions | COMMIT vs ROLLBACK demo | `transaction_demo.sql` | Part A persists then is cleaned up; Part B rolls back; data unchanged | `applicant_count` 3 before and 3 after; 0 demo rows | Pass |
| 2-19 | Consistency | Derived data | SQL: count vs `COUNT(*)`; latest history vs status | 0 mismatches | 0 / 0 | Pass |

## Stage 3 — Authentication and RBAC

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 3-01 | Auth unit | bcrypt hash format | `hashPassword()` | `$2b$12$…`, never the plaintext | As expected | Pass |
| 3-02 | Auth unit | Correct password | `verifyPassword()` | true | As expected | Pass |
| 3-03 | Auth unit | Wrong password | `verifyPassword()` | false | As expected | Pass |
| 3-04 | Auth unit | Random salt | Hash the same password twice | Different hashes | As expected | Pass |
| 3-05 | Auth unit | Unknown user | `verifyPassword(p, null)` | false (dummy hash, same timing) | As expected | Pass |
| 3-06 | Auth unit | > 72 bytes | Hash a 73-byte password | Refused | As expected | Pass |
| 3-07 | Auth unit | JWT round-trip | Sign, verify | Same id and role | As expected | Pass |
| 3-08 | Auth unit | JWT payload | Decode | Only `sub, role, iss, aud, iat, exp` | As expected | Pass |
| 3-09 | Auth unit | Edited payload | Change role in token | Rejected | As expected | Pass |
| 3-10 | Auth unit | Other secret | Sign with another key | Rejected | As expected | Pass |
| 3-11 | Auth unit | Expired | Token with past `exp` | Rejected | As expected | Pass |
| 3-12 | Auth unit | `alg: none` | Unsigned token | Rejected | As expected | Pass |
| 3-13 | Auth unit | Bad tokens | Wrong audience, garbage, empty | Rejected | As expected | Pass |
| 3-14 | Auth unit | Secret config | Missing / short / placeholder secret | Throws without printing the value | As expected | Pass |
| 3-15 | Auth unit | Cookie flags | `sessionCookieOptions()` | httpOnly, SameSite=Lax, path `/`, finite max age | As expected | Pass |
| 3-16 | Auth unit | Secure flag | NODE_ENV production vs not | Secure only in production | As expected | Pass |
| 3-17 | Auth unit | Register schema normalises | Upper-case email, padded name | Lower-cased, trimmed | As expected | Pass |
| 3-18 | Auth unit | Extra fields | `role` in body | Rejected (strict) | As expected | Pass |
| 3-19 | Auth unit | Password rules | Short, no digit | Rejected | As expected | Pass |
| 3-20 | Auth unit | Bad email / missing fields | Parse | Rejected | As expected | Pass |
| 3-21 | Register | Valid sign-up | POST `/api/auth/register` | 201, safe user, cookie HttpOnly + SameSite=Lax + Max-Age=28800; `$2b$12$` hash; candidates row | As expected | Pass |
| 3-22 | Register | Duplicate email (any case) | Register twice | 409 `EMAIL_TAKEN` | As expected | Pass |
| 3-23 | Register | Invalid input | Bad email, short password, … | 400 with field errors | As expected | Pass |
| 3-24 | Register | Privilege escalation | Body with `role: admin`, `isAdmin` | 400, no user row | As expected | Pass |
| 3-25 | Register | Content-type / JSON / CSRF | Form body, malformed JSON, foreign Origin | 415 / 400 / 403 `CROSS_ORIGIN` | As expected | Pass |
| 3-26 | Login | Seeded accounts | Admin, recruiter, candidate | 200 with the right role, no hash in body | As expected | Pass |
| 3-27 | Login | Email case | Upper-case email | 200 | As expected | Pass |
| 3-28 | Login | No account enumeration | Wrong password vs unknown email | Identical 401 `INVALID_CREDENTIALS`, no cookie | As expected | Pass |
| 3-29 | Login | Invalid input | Missing fields, bad email | 400 | As expected | Pass |
| 3-30 | Login | `last_login_at` | Log in | Set; `updated_at` unchanged (014) | As expected | Pass |
| 3-31 | Login | Disabled account | `is_active = false` | Login 403; existing token 401 | As expected | Pass |
| 3-32 | Session | `/me` anonymous | GET | 401 | As expected | Pass |
| 3-33 | Session | `/me` signed in | GET | Exactly `id, email, fullName, role` | As expected | Pass |
| 3-34 | Session | Forged tokens | Garbage, tampered, wrong secret, `none`, expired | 401 | As expected | Pass |
| 3-35 | Session | Role in token ≠ DB | Validly signed token claiming admin for a candidate, on `/me` and `/api/admin/dashboard`; token for a missing user | 401 (DB is the source of truth) | As expected | Pass |
| 3-36 | Logout | Clear cookie | POST logout | `Max-Age=0`, same flags; `/me` then 401 | As expected | Pass |
| 3-37 | Logout | Without session | POST logout | 200 | As expected | Pass |
| 3-38 | RBAC | Anonymous on role routes | GET `/api/admin/dashboard`, `/api/recruiter/jobs`, `/api/candidate/profile` | 401 ×3 | As expected | Pass |
| 3-39 | RBAC | Demo routes removed (Stage 9) | Admin GETs `/api/demo/admin`, `/recruiter`, `/candidate`, `/users/1` | 404 ×4 | As expected | Pass |
| 3-40 | RBAC | Admin | The three role routes | 200 on the admin dashboard, 403 `FORBIDDEN` on the other two | As expected | Pass |
| 3-41 | RBAC | Recruiter | The three role routes | 200 on recruiter jobs, 403 on the other two | As expected | Pass |
| 3-42 | RBAC | Candidate | The three role routes | 200 on candidate profile, 403 on the other two | As expected | Pass |
| 3-43 | Secrets | Responses | Scan every response body and header seen in the run | No JWT secret, DB password or bcrypt hash | As expected | Pass |
| 3-44 | Secrets | Git | Scan tracked files | No secret; `.env.local` not tracked | As expected | Pass |

## Stage 4 — Candidate module

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 4-01 | Candidate | Access control | Candidate endpoints anonymous / as recruiter | 401 / 403 | As expected | Pass |
| 4-02 | Profile | Read + update own | GET, PATCH; body with `role` | 200 with saved values; 400 | As expected | Pass |
| 4-03 | Profile | Clear optional fields | PATCH with `null` / `""` | 200, stored as NULL | As expected | Pass |
| 4-04 | Skills | Add / remove; bad proficiency | POST, DELETE; proficiency 8 | 201, 200; 400 | As expected | Pass |
| 4-05 | Skills | Upsert | Same skill twice | 201 `created: true`, then 200 `created: false` | As expected | Pass |
| 4-06 | Skills | Other candidate's skill | DELETE Aditi's skill | 404, row kept | As expected | Pass |
| 4-07 | Resumes | Text upload, list, delete | Upload .txt; other candidate deletes; owner deletes | 201; 404 (row kept); 200 | As expected | Pass |
| 4-08 | Resumes | Real PDF | Upload `tests/fixtures/sample-resume.pdf` | 201, primary, text extracted | As expected | Pass |
| 4-09 | Resumes | Bad files | 5 MB + 1, `.docx`, PNG named `.pdf`, text named `.pdf`, broken PDF | 413 / 415 / 415 / 400 / 400; nothing saved | As expected | Pass |
| 4-10 | Resumes | Set primary | PATCH; again; other candidate; bad bodies | Exactly one primary; 404 / 400 for misuse | As expected | Pass |
| 4-11 | Resumes | Concurrency | 8 parallel first uploads | All 201, exactly 1 primary | As expected | Pass |
| 4-12 | Jobs | Role restriction | Anonymous / recruiter / admin | 401 / 403 / 403 | As expected | Pass |
| 4-13 | Jobs | Only open jobs | GET `/api/candidate/jobs` | All open jobs, no draft or closed | As expected | Pass |
| 4-14 | Jobs | Keyword search | `devops`, `python`, no match, `%`, `' OR 1=1 --` | Matches; injection text treated as text (0 rows) | As expected | Pass |
| 4-15 | Jobs | Filters | Location, type, experience, combined | Same ids as the equivalent SQL | As expected | Pass |
| 4-16 | Jobs | Invalid filters | Bad type, −1, `abc`, `status=draft`, 101 chars | 400 | As expected | Pass |
| 4-17 | Jobs | `hasApplied` | As Aditi | True exactly for her applications | As expected | Pass |

## Stage 5 — Semantic matching (pgvector)

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 5-01 | Embeddings unit | Short text | `chunkWords` | 1 chunk | As expected | Pass |
| 5-02 | Embeddings unit | Chunk limit + overlap | 50 words, max 20, overlap 5 | ≤ 20 tokens, overlapping chunks | As expected | Pass |
| 5-03 | Embeddings unit | Word pieces | Long words | Words never split | As expected | Pass |
| 5-04 | Embeddings unit | `maxChunks` | 1000 words, max 3 | 3 chunks, `truncated: true` | As expected | Pass |
| 5-05 | Embeddings unit | Bad overlap | overlap ≥ max | Error | As expected | Pass |
| 5-06 | Embeddings unit | Weighted mean | `[1,0]×3`, `[0,1]×1` | Unit length, ratio 3:1 | As expected | Pass |
| 5-07 | Embeddings unit | Zero vector | Opposite vectors | Error | As expected | Pass |
| 5-08 | Embeddings unit | pgvector literal | 384 / 3 numbers / NaN | Literal / error / error | As expected | Pass |
| 5-09 | Embeddings unit | Source hash | Whitespace-only change | Same hash | As expected | Pass |
| 5-10 | Embeddings unit | Job text | Title + description + required skills | Exact string | As expected | Pass |
| 5-11 | Embeddings unit | Failing embedder | `tryEmbedResume` with a throwing model | Returns false, 0 queries | As expected | Pass |
| 5-12 | Embeddings unit | Real model shape | One sentence | 384 dims, unit length, model name, hash | As expected | Pass |
| 5-13 | Embeddings unit | Deterministic | Same text twice | Dot product > 0.9999 | As expected | Pass |
| 5-14 | Embeddings unit | Long text | ~840 words | ≥ 3 chunks, unit length | As expected | Pass |
| 5-15 | Embeddings unit | Semantics | ML job vs ML / React sentence | ML pair closer | As expected | Pass |
| 5-16 | Validation unit | Matches query defaults | `{}` | `applicantsOnly false, limit 10` | As expected | Pass |
| 5-17 | Validation unit | Parse strings | `applicantsOnly=true&limit=5` | `{true, 5}` | As expected | Pass |
| 5-18 | Validation unit | Bad values | `yes`, 0, 51, 2.5, `abc`, `sort` | Rejected | As expected | Pass |
| 5-19 | Ranking | ML job | `rank_candidates_for_job` | ML/data candidates above frontend-only ones | 1 Aditi 0.7819, 2 Rohan 0.6658, 3 Divya 0.5032, 4 Ishita 0.4378 … 10 Vikram 0.2748, 12 Sneha 0.2438 | Pass |
| 5-20 | Ranking | Frontend job | Same | Frontend candidates above ML/data ones | 1 Sneha 0.7552, 2 Vikram 0.7460; best ML/data is Aditi at 8 (0.2619) | Pass |
| 5-21 | Ranking | Scores are real cosine | Compare with `1 - (a <=> b)` in SQL | Equal (≤ 0.00005), sorted descending | As expected | Pass |
| 5-22 | Ranking | Applicants only | `p_applicants_only = TRUE` | Exactly the job's applicants | As expected | Pass |
| 5-23 | Matches API | Own company | Meera → Nimbus ML job, `limit=5` | 200, identical to the SQL function | As expected | Pass |
| 5-24 | Matches API | Applicants only | Arjun, `applicantsOnly=true` | Every row `hasApplied` | As expected | Pass |
| 5-25 | Matches API | Other company | Kavya → Nimbus job | 403 | As expected | Pass |
| 5-26 | Matches API | Wrong roles | Candidate / admin | 403 / 403 | As expected | Pass |
| 5-27 | Matches API | Anonymous | No cookie | 401 | As expected | Pass |
| 5-28 | Matches API | Bad job id | `999999999`, `abc`, `-1` | 404 | As expected | Pass |
| 5-29 | Matches API | Bad query | `limit=0`, `51`, `yes`, `sort` | 400 | As expected | Pass |
| 5-30 | Matches API | Not embedded | Job without embedding → embed → delete | 404 `NOT_EMBEDDED` → 200 → embedding row gone | As expected | Pass |
| 5-31 | Embedding | On upload | Upload, delete embedding, `embedPending()`, delete resume | Embedded → re-embedded → cascade | As expected | Pass |

## Stage 6 — Recruiter module and applications

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 6-01 | Validation unit | Job defaults | `jobCreateSchema` | draft, onsite, full time, INR, 1 opening, no skills | As expected | Pass |
| 6-02 | Validation unit | Null salary | `salaryMin: null` | Stays null (regression) | As expected | Pass |
| 6-03 | Validation unit | Skill defaults | Skills array | `isRequired` true, `minProficiency` 3 | As expected | Pass |
| 6-04 | Validation unit | Bad job input | 11 bad inputs incl. `companyId` | Rejected | As expected | Pass |
| 6-05 | Validation unit | Job PATCH | Status only / `{}` | OK / rejected | As expected | Pass |
| 6-06 | Validation unit | Status values | Five statuses | Accepted (rules are in the DB) | As expected | Pass |
| 6-07 | Validation unit | Bad status | `hired`, `changedBy` | Rejected | As expected | Pass |
| 6-08 | Flow | Post a job | Meera POSTs with skills | 201, her company, `applicant_count` 0, embedded | As expected | Pass |
| 6-09 | Flow | Apply | New candidate applies | `match_score` = `1 - (resume <=> job)`; count +1 | `match_score stored 0.7972, recomputed 1 - (a <=> b) = 0.797152578830719` | Pass |
| 6-10 | Flow | Apply side effects | Read history + notifications | `NULL → applied` row; recruiter notified | As expected | Pass |
| 6-11 | Flow | Shortlist | PATCH status | Trigger history row with actor + note; candidate notified | As expected | Pass |
| 6-12 | Flow | Views agree | Applicants list, My Jobs, matches, My Applications | Same score and counts everywhere | As expected | Pass |
| 6-13 | Transaction | Apply rollback | Make the last step fail | 0 application / history rows; count unchanged | As expected | Pass |
| 6-14 | Status rules | Skip stages | API `applied → offered` | 409 `INVALID_TRANSITION` | As expected | Pass |
| 6-15 | Status rules | Rejected is final | `rejected → offered` by SQL, function, API | SQL 23514; API 409; nothing changed | As expected | Pass |
| 6-16 | Permissions | Other company | Kavya on a Nimbus job (GET, PATCH, status, DELETE, list) | 403 ×5, nothing changed | As expected | Pass |
| 6-17 | Permissions | Choose company | `companyId` / `recruiterId` in body | 400 | As expected | Pass |
| 6-18 | Applications | Duplicate | Apply twice | 409 `ALREADY_APPLIED`; count unchanged | As expected | Pass |
| 6-19 | Permissions | Candidate changes status | PATCH as candidate / anonymous / Kavya | 403 / 401 / 403 | As expected | Pass |
| 6-20 | Applications | Closed / draft job | Apply | 409 `JOB_NOT_OPEN` / 404 | As expected | Pass |
| 6-21 | Applications | Someone else's resume | Apply with it | 404 | As expected | Pass |
| 6-22 | Jobs | Re-embedding | Edit title + skills; status only | Hash changes; then unchanged | As expected | Pass |
| 6-23 | Jobs | Validation + DB rules | Short description; past `closesAt`; unknown skill | 400 field error / 400 with constraint name; rolled back | As expected | Pass |
| 6-24 | Jobs | Delete | No applications / with applications | 200 (cascade) / 409 `JOB_HAS_APPLICATIONS` | As expected | Pass |
| 6-25 | Skill gap | Aman, ML job | `EXCEPT` query | Has Python (below level); missing NLP, PyTorch | As expected | Pass |
| 6-26 | Skill gap | Aditi, ML job | Same | All three at level; nothing missing | As expected | Pass |
| 6-27 | Skill gap | Completeness + API | have ∪ missing; API | = required skills; API identical | As expected | Pass |

## Stage 7 — Interviews, offers and notifications

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 7-01 | Validation unit | India date | `todayInIndia()` at 20:00 UTC | Next day in Asia/Kolkata | As expected | Pass |
| 7-02 | Validation unit | Schedule defaults | Future video interview | Defaults filled | As expected | Pass |
| 7-03 | Validation unit | Phone | No location | Allowed; `""` → null | As expected | Pass |
| 7-04 | Validation unit | Past time | Schedule in the past | Rejected | As expected | Pass |
| 7-05 | Validation unit | Bad schedule input | 8 cases | Rejected | As expected | Pass |
| 7-06 | Validation unit | Update actions | reschedule / cancel / complete | Accepted | As expected | Pass |
| 7-07 | Validation unit | Bad updates | Rating 0/6/4.5, blank feedback, past reschedule | Rejected | As expected | Pass |
| 7-08 | Validation unit | Valid offer | Coercion, INR default | Accepted | As expected | Pass |
| 7-09 | Validation unit | Expiry today | Offer expiring today | Accepted | As expected | Pass |
| 7-10 | Validation unit | Bad offers | Zero salary, joining today, past expiry, … | Rejected | As expected | Pass |
| 7-11 | Validation unit | Offer response | Only `accept` / `decline` | As described | As expected | Pass |
| 7-12 | Validation unit | Notification PATCH | Only `isRead: true` | As described | As expected | Pass |
| 7-13 | Validation unit | Notification list query | Parse; `userId` | Parsed; rejected | As expected | Pass |
| 7-14 | Interviews | First interview | Schedule for a shortlisted application | 201; application `interviewed` in the same transaction; history + 2 notifications | As expected | Pass |
| 7-15 | Interviews | Round 2 | Schedule again | `round_no` 2; status unchanged | As expected | Pass |
| 7-16 | Interviews | Candidate view | GET `/api/candidate/interviews` | Upcoming; no rating/feedback keys | As expected | Pass |
| 7-17 | Interviews | Reschedule, cancel, final | Reschedule, cancel, try again ×2 | 200, 200, 409 ×2; exactly 2 notifications | As expected | Pass |
| 7-18 | Interviews | Rating range | Rating 0 / 6 by API; 6 by SQL on a past interview | 400 ×2; `interviews_rating_check` | As expected | Pass |
| 7-19 | Interviews | Past time | API −2 h; SQL past insert and reschedule | 400; trigger errors; 0 rows | As expected | Pass |
| 7-20 | Interviews | Location rule | Video without link; onsite without address | 400; `interviews_location_required_check` | As expected | Pass |
| 7-21 | Interviews | Wrong stage | Schedule for an `applied` application | 409; nothing changed | As expected | Pass |
| 7-22 | Offers | Make offer | POST offer | 201 pending; `offered` + history + 2 notifications in one transaction | As expected | Pass |
| 7-23 | Offers | Forced rollback 1 | Second offer (UNIQUE) | 409 `OFFER_EXISTS`; nothing changed | As expected | Pass |
| 7-24 | Offers | Forced rollback 2 | Offer row already exists | Status move, history, notification undone | As expected | Pass |
| 7-25 | Offers | Forced rollback 3 | Blank notification title (last step) | `23514`; no offer, no history, no notification | As expected | Pass |
| 7-26 | Offers | `offered` without offer | Function + API | Refused at COMMIT (deferred trigger); 409 | As expected | Pass |
| 7-27 | Offers | Offer on `applied` | POST offer | 409 `INVALID_TRANSITION` | As expected | Pass |
| 7-28 | Offers | Dates | Past expiry (API); joining today (SQL) | 400; trigger error | As expected | Pass |
| 7-29 | Offers | Wrong responder | Other candidate; recruiter on candidate route | 404; 403; still pending | As expected | Pass |
| 7-30 | Offers | Accept | Candidate accepts | `accepted` + `responded_at`; recruiter notified | As expected | Pass |
| 7-31 | Offers | Respond twice | Decline after accept; accept again | 409 ×2; no second notification | As expected | Pass |
| 7-32 | Offers | Expired | Expiry yesterday → accept; extend → decline | 409 "expired on"; then 200 declined | As expected | Pass |
| 7-33 | Offers | Withdraw | Kavya, then Meera | 403; 200 withdrawn, application rejected, candidate notified | As expected | Pass |
| 7-34 | Offers | Withdraw again | Withdrawn / accepted offer | 409 / 409 | As expected | Pass |
| 7-35 | Offers | Who is told | Arjun's job, Meera's offer, accepted | Exactly Meera and Arjun notified | As expected | Pass |
| 7-36 | Permissions | Other company | Kavya schedules, cancels, offers | 403 ×3; lists exclude them | As expected | Pass |
| 7-37 | Permissions | Candidate | Calls recruiter actions | 403 ×4; anonymous 401; unknown 404 | As expected | Pass |
| 7-38 | Notifications | Own list | GET | Only own ids; correct unread count; `?userId` 400 | As expected | Pass |
| 7-39 | Notifications | Mark read | Other users, then owner | 404 ×2 unchanged; owner 200 | As expected | Pass |
| 7-40 | Notifications | Mark all read | POST read-all | Own rows only; anonymous 401 | As expected | Pass |

## Stage 8 — Admin module and dashboard

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 8-01 | Validation unit | Company create | Trim, `""` → NULL | As described | As expected | Pass |
| 8-02 | Validation unit | Bad company | Blank name, `acme.example`, unknown field | Rejected | As expected | Pass |
| 8-03 | Validation unit | Company PATCH | Partial body | Only sent fields | As expected | Pass |
| 8-04 | Validation unit | Empty PATCH | `{}` | Rejected | As expected | Pass |
| 8-05 | Validation unit | Recruiter create | Email case, `companyId` | Normalised, coerced | As expected | Pass |
| 8-06 | Validation unit | Recruiter password | Same rule as registration | Enforced | As expected | Pass |
| 8-07 | Validation unit | Recruiter bad input | `role`, bad phone, id 0 | Rejected | As expected | Pass |
| 8-08 | Validation unit | `isActive` alone | PATCH | Accepted | As expected | Pass |
| 8-09 | Validation unit | Bad recruiter PATCH | `"false"`, password, `{}` | Rejected | As expected | Pass |
| 8-10 | RBAC | Anonymous | 10 admin route/method pairs | 401 ×10 | As expected | Pass |
| 8-11 | RBAC | Recruiter + candidate | Same 10 | 403 ×20; nothing changed | As expected | Pass |
| 8-12 | RBAC | Admin | List routes | 200 ×3 | As expected | Pass |
| 8-13 | Companies | Create | POST | 201; empty text → NULL | As expected | Pass |
| 8-14 | Companies | Duplicate name | POST twice | 409 `COMPANY_NAME_TAKEN` | As expected | Pass |
| 8-15 | Companies | List / read / edit | GET, PATCH, GET | Only sent fields change | As expected | Pass |
| 8-16 | Companies | Delete unused | DELETE | 200 | As expected | Pass |
| 8-17 | Companies | Delete with jobs (SQL + API) | DELETE | 23503 `jobs_company_fkey`; API 409 `COMPANY_IN_USE` | As expected | Pass |
| 8-18 | Companies | Delete with recruiter | API | 409 `recruiters_company_fkey` | As expected | Pass |
| 8-19 | Companies | Seeded Nimbus | API DELETE | 409 "…2 recruiters and 3 jobs" | As expected | Pass |
| 8-20 | Recruiters | Create | POST | 201; users + recruiters rows; bcrypt hash; can log in | As expected | Pass |
| 8-21 | Recruiters | Duplicate email | POST twice | 409; 1 row | As expected | Pass |
| 8-22 | Recruiters | Atomic (API) | Unknown company | 400; sequence advanced; 0 users rows | As expected | Pass |
| 8-23 | Recruiters | Atomic (forced) | Hook throws after users INSERT | 0 users, 0 recruiters rows | As expected | Pass |
| 8-24 | Recruiters | Role from body | `role: admin` | 400 | As expected | Pass |
| 8-25 | Recruiters | Edit + move | Rename, move a recruiter without jobs | 200 | As expected | Pass |
| 8-26 | Recruiters | Move with jobs | Move Meera | 409 `RECRUITER_OWNS_JOBS` | As expected | Pass |
| 8-27 | Recruiters | Deactivate | `isActive: false` | Same cookie → 401; login 403 | As expected | Pass |
| 8-28 | Recruiters | Reactivate | `isActive: true` | Old cookie → 200 | As expected | Pass |
| 8-29 | Recruiters | Admin account | PATCH user 1 via recruiter route | 404 | As expected | Pass |
| 8-30 | Dashboard | Totals | API vs independent SQL | Equal | `applications 18, interviews 9, offers 3, openJobs 6, candidates 12` (recruiters/companies include the test's own rows on both sides) | Pass |
| 8-31 | Dashboard | Per stage | API vs `GROUP BY` | Equal; sum = total | As expected | Pass |
| 8-32 | Dashboard | Top skills | API vs SQL (≥ 2 open jobs) | Equal | As expected | Pass |
| 8-33 | Dashboard | Score by status | API vs SQL, 4 decimals | Equal | `applied=0.648 shortlisted=0.6546 interviewed=0.8053 offered=0.5408 rejected=0.5814` | Pass |
| 8-34 | Dashboard | Per company | 9 columns + above-average flag | Equal | As expected | Pass |
| 8-35 | Dashboard | Per job | `generate_hiring_pipeline_report()` vs `GROUP BY` | Equal | As expected | Pass |

## Stage 9 — Security, consistency fixes, demo data, clean setup

| ID | Module | Test | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 9-01 | Security | Headers on a page | GET `/login` | nosniff, `DENY`, CSP `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy; no `X-Powered-By` | As expected | Pass |
| 9-02 | Security | Headers on a public API | GET `/api/health` | Same | As expected | Pass |
| 9-03 | Security | Headers on an error response | GET `/api/auth/me` (401) | Same | As expected | Pass |
| 9-04 | Security | Health leaks nothing | GET `/api/health` | Only version numbers | `"version":"17.11"`; no OS/compiler text | Pass |
| 9-05 | Security | CSRF without Origin | Login POST with `Sec-Fetch-Site: cross-site` / `same-site` | 403 `CROSS_ORIGIN`, no cookie | As expected (before the fix: 401 from the login check, i.e. the request was processed) | Pass |
| 9-06 | Security | CSRF with Origin | Foreign Origin; same origin; no headers | 403; 200; 200 | As expected | Pass |
| 9-07 | Security | Cookie flags (live) | Login against `next start` | HttpOnly, SameSite, Secure, 8 h | `Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=lax` | Pass |
| 9-08 | Security | Login message (live) | Unknown email vs wrong password | Identical body | Both `{"error":{"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}}` | Pass |
| 9-09 | Security | Parameterized SQL | `grep` every `query(` with `${…}` | Only fixed column lists / whitelisted column maps | As expected ([security-review.md §2](security-review.md#2-cross-cutting-checks)) | Pass |
| 9-10 | Secrets | `.env*` ignored | `git check-ignore -v` | Ignored; only `.env.example` tracked | `.gitignore:25:.env*` for `.env.local`, `.env`, `.env.production` | Pass |
| 9-11 | Secrets | History | `git log --all -p -S<value>` for the 3 real values; pattern search | 0 commits | 0 / 0 / 0 commits; pattern hits are test fixtures, demo password, placeholder only | Pass |
| 9-12 | Secrets | Dependencies | `npm install` in a clean clone | No known vulnerabilities | `found 0 vulnerabilities` | Pass |
| 9-13 | Consistency | Reject offered → offer withdrawn (API) | Offer, then status PATCH `rejected` | Offer `withdrawn` in the same transaction; one `offer_withdrawn`; candidate cannot accept (409); 0 pending offers on rejected applications | As expected | Pass |
| 9-14 | Consistency | Reject via SQL + rollback | `update_application_status(…, 'rejected')` inside BEGIN, ROLLBACK; then for real | Rolled back together; then withdrawn | As expected | Pass |
| 9-15 | Consistency | Declined offer untouched | Reject an application whose offer was declined | Offer stays `declined`; no withdrawal notice | As expected | Pass |
| 9-16 | Consistency | Complete a future interview (API) | PATCH `complete` on a round 48 h ahead; then a round 3 s ahead after it passes | 409 `RULE_VIOLATION` "…before its scheduled time", row unchanged; then 200 | As expected | Pass |
| 9-17 | Consistency | Complete a future interview (SQL) | UPDATE to `completed`, `no_show`; move-to-past + complete in one UPDATE | 23514 ×3, row unchanged | As expected | Pass |
| 9-18 | Negative control | Without migration 020 | Drop `trg_applications_withdraw_offer`, run pipeline tests, recreate | 9-13 and 9-14 fail | `# pass 29  # fail 2` (exactly those two) | Pass |
| 9-19 | Negative control | Without migration 021 | Restore the 019 function, run pipeline tests, re-apply 021 | 9-16 and 9-17 fail | `# pass 30  # fail 2` (exactly those two) | Pass |
| 9-20 | Consistency | Whole database after seed | SQL counts | 0 pending offers on rejected applications, 0 accepted offers on rejected applications, 0 completed/no-show interviews in the future, 0 offered applications without an offer | 0 / 0 / 0 / 0 | Pass |
| 9-21 | Demo data | Accepted + declined offers | `db:seed`; dashboard API | 1 accepted, 1 declined, 1 pending | Orbitline accepted 1 → **100%**; Kestrel declined 1 → **0%**; Nimbus pending → "awaiting reply" | Pass |
| 9-22 | Demo data | Rebuild | `db:reset → migrate → seed → embed` | All succeed; every application scored | 22 applied; 12 resumes + 8 jobs embedded, 0 failed; `18 match score(s) filled in` | Pass |
| 9-23 | Demo data | Scores are real | Max `abs(match_score − (1 − (resume <=> job)))` over all applications | ≤ 0.00005 (rounding to 4 decimals) | 0.0000432 | Pass |
| 9-24 | Regression | Stage 2 T13 | Run `stage2_advanced_tests.sql` | Passes | Failed before the fix (`cannot TRUNCATE "applications" because it has pending trigger events`, also without migration 020, so it dates from 018); passes in its own transaction | Pass |
| 9-25 | Setup | Clean clone, README only | `git clone` of commit `4d67105`; `npm install`; `.env.local` from the template; `docker compose config`; reset; migrate; seed; embed (model downloaded fresh); `npm run build`; `npm start` and `npm run dev` with no env vars in the shell | App works from a fresh checkout | `npm install`: 0 vulnerabilities; `Done: 22 applied`; 18 scores filled in; health 200 (`17.11`, pgvector `0.8.7`); admin, recruiter and candidate log in; dashboard 100% / 0% / awaiting reply; matches 200 (Aditi 0.782, Rohan 0.666, Divya 0.503); resume upload 201 and embedded (creates `uploads/`); `/`, `/login`, `/register` 200; `/api/demo/admin` 404 under both `npm start` and `npm run dev`. (README gaps found by the first clean-clone run earlier in the stage and fixed: no `build`/`start` step, no "start over" steps, test ports 3100-3104 → 3100-3105) | Pass |

| 9-26 | Consistency | Reject after an accepted offer (API) | Status PATCH `rejected` on the application whose offer the candidate accepted | 409 `RULE_VIOLATION` "…cannot be rejected: the candidate accepted its offer…"; status, offer, history, notifications unchanged | As expected | Pass |
| 9-27 | Consistency | Reject after an accepted offer (SQL) | `update_application_status(…, 'rejected')`; plain `UPDATE … SET status = 'rejected'` | 23514 ×2 from `trg_applications_accepted_offer_guard`; nothing changed | As expected | Pass |
| 9-28 | Negative control | Without migration 022 | Drop `trg_applications_accepted_offer_guard`, run pipeline tests, recreate | 9-26 and 9-27 fail | `# pass 32  # fail 2` (exactly those two) | Pass |
| 9-29 | Rate limit unit | Limits | Constants | 5 attempts, 15 minutes | As expected | Pass |
| 9-30 | Rate limit unit | Block after 5 | 6 attempts on a fake clock; +60 s | 6th blocked, `retryAfterSeconds` 900 then 840 | As expected | Pass |
| 9-31 | Rate limit unit | Reset | 4 attempts, reset, 6 more | 5 allowed after reset, 6th blocked | As expected | Pass |
| 9-32 | Rate limit unit | Window end | 15 min − 1 ms, then 15 min | Blocked, then allowed | As expected | Pass |
| 9-33 | Rate limit unit | Independent keys | Other email; other IP | Allowed | As expected | Pass |
| 9-34 | Rate limit unit | Bounded memory | `maxEntries` 3; expired and live keys | Expired pruned first, then oldest; size never above 3 | As expected (failed on the first version: a full map grew to 4; fixed before commit) | Pass |
| 9-35 | Rate limit unit | Client IP | `X-Forwarded-For` list, `X-Real-IP`, none | First XFF entry / X-Real-IP / `unknown` | As expected | Pass |
| 9-36 | Rate limit | Lockout | 5 wrong passwords, a 6th, then the right password; then another IP | 401 ×5; 429 `TOO_MANY_ATTEMPTS` "Try again in 15 minutes.", `Retry-After` 1–900, no cookie; right password still 429; other IP 200 | As expected | Pass |
| 9-37 | Rate limit | Reset on success | 4 wrong, right, 5 wrong, 1 more | 401 ×4, 200, 401 ×5, 429 | As expected | Pass |
| 9-38 | Rate limit | Unknown email | 6 attempts for a non-existent account | 401 ×5 then 429 (no account enumeration) | As expected | Pass |
| 9-39 | Rate limit | Invalid input | 8 requests without a password, then a correct login | 400 ×8 (not counted), then 200 | As expected | Pass |
| 9-40 | Rate limit | Parallel attempts | 50 wrong logins at once | At most 5 password checks | `{ 401: 5, 429: 45 }` | Pass |
| 9-41 | Negative control | Limiter disabled | `consume()` replaced by "always allowed", rebuild, run `security.test.js`, restore (byte-identical) and rebuild | The limiting tests fail | `# pass 7  # fail 4` (9-36, 9-37, 9-38, 9-40; 9-39 passes either way) | Pass |
| 9-42 | Consistency | Live auth values on the final build | Login with unknown email / wrong password / right password against `next start` | Identical 401 bodies; cookie flags | Both `{"error":{"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}}`; `Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=lax` | Pass |

`docker compose up` was run from the project folder (same committed file; the container already existed). Running it from the clone would have recreated the existing `talentmatch-db` container with its `db/init` mount pointing into the temporary clone. The compose file in the clone was validated with `docker compose config`.

---

## Not re-run in Stage 9

These were run and recorded in earlier stages but were **not** repeated in the final run, so they are not marked Pass here.

| ID | Check | Last run | Why not re-run |
|---|---|---|---|
| N-01 | `db:reset` refuses the native Postgres (5432), a non-local host, and a wrong confirmation | Stage 1 (2026-10-09) | Only the normal `--yes` path was run; the safety code (`scripts/lib/db-target.js`) did not change |
| N-02 | Browser checks with headless Chrome: candidate (Stage 4, 9 steps), recruiter flow (Stage 6, 12 checks), interviews/offers (Stage 7, 17 checks), admin (Stage 8, 12 steps) | 2026-10-16, Stages 4–8 | The driver scripts were throw-away scratch files and are not in the repo |
| N-03 | Stage 9 UI change: "Mark completed" is hidden until the interview time has passed | — | Build only; not clicked in a browser. The database refuses an early completion either way (9-16, 9-17) |
| N-04 | Earlier negative controls: role guard removed (Stage 3), resume row lock removed (Stage 4), apply without a transaction (Stage 6), recruiter create without BEGIN (Stage 8) | Stages 3–8 | Those tests are unchanged and still pass; only the two new controls (9-18, 9-19) were run |
| N-05 | EXPLAIN ANALYZE showing the HNSW index (Stage 5) | Stage 5 | Not part of the test suites |
| N-06 | Screenshots in `docs/screenshots/stage7` and `stage8` | Stages 7–8 | Taken with the earlier seed; the dashboard now shows the new acceptance rates |

## Bugs found by tests, by stage

| Stage | Bug | Found by | Fix |
|---|---|---|---|
| 4 | Every PDF upload failed in the production build (bundled pdfjs worker path) | Real-PDF integration test | `serverExternalPackages: ["pdfjs-dist"]` |
| 4 | Two parallel first uploads could both become primary | Concurrency test 4-11 | Lock the candidate row in the upload transaction |
| 4 | Re-adding a skill returned 201 | Test 4-05 | `RETURNING (xmax = 0)` |
| 6 | Empty salary saved as ₹0 | Browser check | Keep `null` before coercion (test 6-02) |
| 7 | Withdrawing / cancelling / accepting twice returned 200 and notified again | Test 7-34 | Migration 019 freezes final rows |
| 7 | The offer maker was not told when a colleague's job offer was accepted | Browser check | Notify poster and offer maker (test 7-35) |
| 8 | Layout bugs (nav offset, 790 px page on a phone, stretched inputs, wrapped headers) | Screenshot checks | CSS fixes |
| 9 | Pending offer stayed attached to a rejected application | Flagged in Stage 7 | Migration 020 (tests 9-13 to 9-15) |
| 9 | An interview could be completed before it happened | Flagged in Stage 7 | Migration 021 (tests 9-16, 9-17) |
| 9 | No security headers; health leaked the server build; CSRF check ignored `Sec-Fetch-Site` | Live probe of `next start` | See [security-review.md §3](security-review.md#3-problems-found-and-fixed-in-stage-9) |
| 9 | Stage 2 T13 failed since migration 018 | Re-running every SQL suite | T13 in its own transaction |
| 9 | A failing assertion inside the new rollback test left its transaction open, so `after()` clean-up was discarded and test users stayed in the database | Negative-control run (9-18) | Always ROLLBACK in `finally` |
| 9 | An application whose offer was accepted could still be rejected | Flagged in the Stage 9 review | Migration 022 (tests 9-26, 9-27) |
| 9 | The first version of the login limiter freed no slot when its map was full, so memory could keep growing | Unit test 9-34 | Drop the oldest entry until there is room |

## Known minor issues

| Where | Issue | Impact | Why it is not fixed |
|---|---|---|---|
| Recruiter → job → Ranked applicants | After a refused status change (e.g. the 409 for `rejected -> shortlisted`), that applicant's row keeps showing the error and the chosen status until the page is reloaded, even after other actions on the page refresh the list. | Cosmetic: the database state is correct and the message is accurate for the attempt that was made. | Found in the Stage 10 walkthrough and left as is on purpose; the row keeps its own form state, and the reload clears it. |
