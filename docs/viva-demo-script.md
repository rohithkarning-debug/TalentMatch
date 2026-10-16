# TalentMatch — Viva Demo Script

A 10-minute live demo, a "show the database" section with psql statements to run live, and 30 likely viva questions with short answers.

All outputs quoted below are real, from the seeded database on 16 Oct 2026. Ids (job 2, application 4, user 3 …) are those of a fresh seed; if you ran the UI demo first, the psql blocks still work because each one runs inside a transaction that is rolled back.

## 0. Before the viva (5 minutes, not part of the 10)

```powershell
docker compose --env-file .env.local up -d --wait
npm run db:reset -- --yes; npm run db:migrate; npm run db:seed; npm run db:embed
npm run build; npm start
```

- Open http://localhost:3000/api/health (must say `"status":"ok"`).
- Open a second terminal for psql: `docker exec -it talentmatch-db psql -U talentmatch -d talentmatch`, then `\pset pager off`.
- Have three browser windows (or private windows) ready, one per role, so you never have to log out on stage.
- Keep `tests/fixtures/sample-resume.pdf` at hand for the upload.
- Password for every demo account: `TalentMatch@2026`.

## 1. Ten-minute demo order

| Time | Who / account | What to click and say |
|---|---|---|
| 0:00–1:00 | — | **Problem and design.** Recruiters miss good candidates because keyword search ignores meaning. Show the ER diagram (`docs/er-diagram.png`): 16 tables, `applications` in the centre, two vector tables. One PostgreSQL database holds both the relational data and the vectors (pgvector). |
| 1:00–1:45 | Login page | Show `/login`. Try a wrong password once: same message for unknown email and wrong password. Point out "Create account" only makes **candidates**. |
| 1:45–3:30 | **Candidate** `ananya.gupta@mail.example` | **Profile** → show skills with proficiency 1–5. Upload `sample-resume.pdf` → it is stored and embedded ("embedded" badge). **Jobs** → type `react` in Keyword, filter Work mode → open **Frontend Developer (React / Next.js)** → **Skill gap** panel (have / below level / missing, an `EXCEPT` query) → choose the resume → **Apply**. The **match score** shown is `1 - (resume <=> job)` computed by PostgreSQL. **Applications** → status `applied` with its history row (written by a trigger). |
| 3:30–6:30 | **Recruiter** `kavya.menon@kestrellabs.example` | **My jobs** → Frontend Developer → **Ranked applicants**: Ananya is now in the list, ordered by match score, with matched / required skills. **Search all candidates** tab: semantic search over every candidate, including people who did not apply. On Ananya, **Change status… → offered → Update** → refused with the database's message *"Invalid application status transition: applied -> offered"* (the trigger). Then **shortlisted**, note "Good portfolio" → **Update** → **Show history**. On Aman (shortlisted) → **Schedule interview** → pick a time tomorrow, video, any link → status becomes `interviewed` in the same transaction. On Sneha (interviewed) → **Make offer** → refused: *"Complete or cancel the scheduled interview before making an offer."* (migration 023). **Interviews** → Sneha round 2 → **Cancel**. Back on the job → Sneha → **Make offer** (salary, joining date next month, expiry next week) → offer created. |
| 6:30–7:15 | **Candidate** `sneha.kulkarni@mail.example` | **Notifications**: interview cancelled, offer made. **Offers** → **Accept**. |
| 7:15–8:00 | **Recruiter** `kavya.menon@…` (refresh) | Notifications: "offer accepted". Try to reject Sneha now → refused (*accepted offer is final*, migration 022). Paste the URL of a Nimbus job, `/recruiter/jobs/3` → **403**: the company check is done on the server. |
| 8:00–9:00 | **Admin** `admin@talentmatch.example` | **Dashboard**: totals, applications per stage, top skills (GROUP BY + HAVING), average match score by outcome (a view), per-company acceptance rate, per-job funnel (`generate_hiring_pipeline_report()`). **Companies** → Delete *Nimbus Analytics* → refused: still has recruiters and jobs (`ON DELETE RESTRICT`). **Recruiters** → workload columns from `recruiter_pipeline_view`. |
| 9:00–10:00 | psql | Pick two or three blocks from §2: the constraint block (A), the trigger + rollback block (B), and the ranking + `EXPLAIN ANALYZE` block (E). |

After the viva, run the reset commands again to return to the clean seed.

The click path uses flows covered by the integration tests and the final screenshots, but it was not clicked through end to end in a browser when this script was written. Rehearse it once on a fresh seed before the viva.

## 2. Show the database (live psql)

Each block can be pasted as a whole. Errors are expected where marked.

### A. Constraints reject bad data

```sql
-- Plaintext password: refused by a CHECK that only accepts bcrypt hashes
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('demo.viva@mail.example', 'password123', 'Viva Demo', 'candidate');
-- ERROR: new row for relation "users" violates check constraint "users_password_hash_bcrypt_check"

-- salary_max below salary_min
UPDATE jobs SET salary_min = 2000000, salary_max = 1000000 WHERE job_id = 3;
-- ERROR: ... violates check constraint "jobs_salary_range_check"

-- Second application to the same job by the same candidate
INSERT INTO applications (job_id, candidate_id) VALUES (3, 6);
-- ERROR: duplicate key value violates unique constraint "applications_job_id_candidate_id_key"

-- Proficiency outside 1-5
INSERT INTO candidate_skills (candidate_id, skill_id, proficiency) VALUES (6, 1, 9);
-- ERROR: ... violates check constraint "candidate_skills_proficiency_check"

-- Company that still has recruiters (ON DELETE RESTRICT)
DELETE FROM companies WHERE company_id = 1;
-- ERROR: update or delete on table "companies" violates foreign key constraint "recruiters_company_fkey"
```

### B. Triggers firing (inside a rolled-back transaction)

```sql
BEGIN;
SELECT job_id, title, applicant_count FROM jobs WHERE job_id = 2;          -- Data Analyst | 3
INSERT INTO applications (job_id, candidate_id) VALUES (2, 10)
RETURNING application_id, status;                                          -- status applied
SELECT applicant_count FROM jobs WHERE job_id = 2;                         -- 4  (trg_applications_applicant_count)
SELECT h.old_status, h.new_status, u.full_name AS changed_by, h.note
  FROM application_status_history h JOIN users u ON u.user_id = h.changed_by
 WHERE h.application_id = (SELECT application_id FROM applications WHERE job_id = 2 AND candidate_id = 10);
--  (null) | applied | Ananya Gupta | Application submitted               (trg_applications_status_history)
UPDATE applications SET status = 'offered' WHERE job_id = 2 AND candidate_id = 10;
-- ERROR: Invalid application status transition: applied -> offered (application …)
-- HINT:  Allowed: applied->shortlisted|rejected, shortlisted->interviewed|rejected, interviewed->offered|rejected, offered->rejected. rejected is final.
ROLLBACK;
SELECT applicant_count FROM jobs WHERE job_id = 2;                         -- 3 again
```

### C. Transaction rollback (atomicity)

```sql
BEGIN;
INSERT INTO applications (job_id, candidate_id) VALUES (2, 10);
INSERT INTO notifications (user_id, type, title, message)
VALUES (3, 'application_submitted', 'New application', 'Ananya applied');
SELECT applicant_count AS inside_txn FROM jobs WHERE job_id = 2;           -- 4
INSERT INTO applications (job_id, candidate_id) VALUES (2, 10);            -- ERROR: duplicate key
SELECT 1;                                                                  -- ERROR: current transaction is aborted
ROLLBACK;
SELECT applicant_count AS after_rollback FROM jobs WHERE job_id = 2;       -- 3
SELECT count(*) FROM applications WHERE job_id = 2 AND candidate_id = 10;  -- 0: application, history row and notification all gone
```

The longer version with COMMIT, ROLLBACK and SAVEPOINT parts: `\i` is not available inside the container, so run it from PowerShell: `Get-Content db/demos/transaction_demo.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch` (Data Analyst `applicant_count` is 3 before and 3 after).

### D. Function + deferred constraint trigger

```sql
BEGIN;
-- Arjun (user 3, Data Analyst recruiter) shortlists Rohan's application 4
SELECT application_id, status FROM update_application_status(4, 'shortlisted', 3, 'Strong SQL test');
SELECT old_status, new_status, changed_by, note FROM application_status_history
 WHERE application_id = 4 ORDER BY changed_at;                             -- applied -> shortlisted by 3
SELECT type, title FROM notifications WHERE related_application_id = 4
 ORDER BY created_at DESC LIMIT 1;                                         -- status_changed
-- Kavya (user 4) works for another company
SELECT * FROM update_application_status(4, 'interviewed', 4, 'not my company');
-- ERROR: User 4 is not allowed to update application 4
ROLLBACK;

-- Deferred check: 'interviewed' without an interview is accepted at first, refused at COMMIT
BEGIN;
SELECT application_id, status FROM update_application_status(3, 'interviewed', 3, 'no interview yet');  -- interviewed
COMMIT;
-- ERROR: Application 3 cannot be interviewed without an interview; schedule one instead
SELECT status FROM applications WHERE application_id = 3;                  -- still shortlisted
```

### E. Ranking function and EXPLAIN ANALYZE on the vector query

```sql
SELECT full_name, similarity, matched_skills || '/' || required_skills AS skills, has_applied
  FROM rank_candidates_for_job(3, 5);          -- job 3 = Machine Learning Engineer
--  Aditi Sharma    | 0.7819 | 3/3 | t
--  Rohan Verma     | 0.6658 | 1/3 | t      <- semantic match despite 1/3 keyword skills
--  Divya Krishnan  | 0.5032 | 3/3 | t
--  Ishita Banerjee | 0.4378 | 0/3 | f
--  Aman Malhotra   | 0.4241 | 0/3 | t

SELECT full_name, similarity FROM rank_candidates_for_job(6, 3, TRUE);   -- Frontend job, applicants only
--  Sneha Kulkarni 0.7552 | Vikram Chauhan 0.7460 | Aman Malhotra 0.6429

-- Default plan: 12 rows, the planner prefers an exact sequential scan
EXPLAIN ANALYZE
SELECT re.resume_id FROM resume_embeddings re
 ORDER BY re.embedding <=> (SELECT embedding FROM job_embeddings WHERE job_id = 3) LIMIT 5;
--  Limit -> Sort (top-N heapsort) -> Seq Scan on resume_embeddings re   Execution Time: 0.038 ms

-- Force the index to show it exists and works
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN ANALYZE
SELECT re.resume_id FROM resume_embeddings re
 ORDER BY re.embedding <=> (SELECT embedding FROM job_embeddings WHERE job_id = 3) LIMIT 5;
--  Limit -> Index Scan using resume_embeddings_embedding_hnsw_idx on resume_embeddings re
--           Order By: (embedding <=> (InitPlan 1).col1)                  Execution Time: 0.991 ms
ROLLBACK;

\d+ resume_embeddings      -- vector(384), HNSW index, unit-length CHECK, FK ON DELETE CASCADE
```

### F. Views

```sql
SELECT job_title, total_applications, applied, shortlisted, interviewed, offered, rejected, upcoming_interviews
  FROM recruiter_pipeline_view ORDER BY job_id;
SELECT company_name, total_applications, rejection_rate_pct, offers_made, offers_accepted
  FROM company_hiring_summary;           -- HAVING hides companies without applications
SELECT job_title, application_status, next_interview_at, offer_status
  FROM candidate_application_view WHERE candidate_name = 'Rohan Verma';
--  Data Analyst | applied | | ;  Machine Learning Engineer | offered | | pending
```

Seed output of `company_hiring_summary`: Orbitline 4 applications (25.0 % rejected, 1 offer, 1 accepted), Nimbus 8 (12.5 %, 1 offer, 0 accepted), Kestrel 6 (33.3 %, 1 offer, 0 accepted).

## 3. Thirty likely viva questions

**1. What problem does TalentMatch solve, and why is it not just CRUD?**
Recruiters miss good candidates because keyword search ignores meaning, and simple tools let the hiring data become inconsistent. TalentMatch ranks candidates by meaning (embeddings + cosine similarity) and enforces the hiring workflow inside the database with triggers, functions, deferred constraints and transactions. Most of the logic is rules, ranking and analytics, not plain inserts and selects.

**2. Why SQL plus a vector database? Why pgvector instead of Pinecone or Qdrant?**
Hiring records are structured and must stay consistent, so they belong in relational tables with keys and constraints. Resume and job text is unstructured, and its meaning is best compared as vectors. pgvector keeps the vectors in the same database, so one query can combine a vector sort with relational filters, the vectors have real foreign keys (deleting a resume deletes its vector), and there is only one system to secure and back up. Our scale (thousands of resumes) is well within what pgvector handles.

**3. What is an embedding, and which model do you use?**
An embedding is a list of numbers that represents the meaning of a text; texts with similar meaning get vectors pointing in similar directions. We use `sentence-transformers/all-MiniLM-L6-v2`, which outputs 384 numbers. It is small (about 22 M parameters, ~90 MB), fast on a laptop CPU, trained for sentence similarity, and runs locally with `@huggingface/transformers`, so resumes never leave our server and there are no API keys or costs.

**4. What exactly is embedded?**
For a resume, the text extracted from the uploaded PDF or TXT. For a job, `title + description + "Required skills: …"` (only required skills, so nice-to-haves do not pull the vector away). Every resume is embedded; ranking uses the candidate's primary resume.

**5. How are the vectors stored?**
In `resume_embeddings` and `job_embeddings`: column `embedding vector(384)`, primary key that is also a foreign key with `ON DELETE CASCADE`, plus `model_name`, `chunk_count` and `source_hash` (SHA-256 of the embedded text). A CHECK refuses any vector that is not unit length. If the text or the model changes, the hash or model name no longer matches and `npm run db:embed` re-embeds it.

**6. What is cosine similarity, and what does `<=>` do?**
Cosine similarity measures the angle between two vectors: 1 means the same direction (same meaning), 0 unrelated. pgvector's `<=>` operator returns the cosine **distance**, which is `1 − cosine similarity`, so our score is `1 - (a <=> b)`. Cosine ignores length, so a long resume and a short job post can still match. Because our vectors are normalised, cosine, dot product and Euclidean distance give the same ranking.

**7. What is HNSW, and why does the planner not use it on your data?**
HNSW (Hierarchical Navigable Small World) is a graph index for approximate nearest-neighbour search: instead of comparing the query with every vector, it walks a graph towards the closest ones. We created it with `vector_cosine_ops` so it serves `ORDER BY embedding <=> x LIMIT k`. With only 12 resumes, reading all 12 and sorting is cheaper than walking a graph (0.04 ms vs about 1 ms), and it is exact, so the planner correctly picks a sequential scan. `SET enable_seqscan = off` shows the index works. With thousands of rows the planner switches to it by itself, with no query change.

**8. Why do you chunk resumes, and how?**
The model reads at most 256 word pieces at a time. We split the text into chunks of up to 254 tokens (two are reserved for special tokens) with a 32-token overlap so a sentence at a border is seen whole, never splitting a word, with a cap of 40 chunks. Each chunk is embedded, then we take a token-weighted mean and L2-normalise it again. Limitation: averaging blurs a resume with mixed content.

**9. Why normalise vectors (L2 normalisation)?**
After dividing by its length, every vector has length 1. Then cosine similarity equals a simple dot product, scores are comparable, and the database CHECK can verify the property. Mean pooling of chunks breaks the unit length, so we normalise again after averaging.

**10. Explain normalisation (1NF–3NF) with your schema.**
1NF: values are atomic — a candidate's skills are rows in `candidate_skills`, not a comma-separated column. 2NF: in `candidate_skills (candidate_id, skill_id)` the non-key columns `proficiency` and `years_used` depend on the whole key; the skill's name depends only on `skill_id`, so it lives in `skills`. 3NF: no non-key column depends on another non-key column — `jobs` stores `company_id`, not the company's name or website. The one deliberate exception is `jobs.applicant_count`, kept exact by a trigger for fast job lists.

**11. Which triggers do you have?**
19 triggers. Eight `set_updated_at` triggers keep `updated_at` current (only when a real column changed). On `applications`: `applicant_count` (+1/−1, and a TRUNCATE trigger resetting to 0), `initial_status` (new rows must be `applied`), `status_guard` (only allowed transitions), `status_history` (writes the audit row with who and why), `stage_records` (deferred: `interviewed` needs an interview, `offered` a pending offer), `withdraw_offer` (rejecting withdraws a pending offer), `accepted_offer_guard` (no rejection after an accepted offer). On `interviews`: `interviews_guard` (future time, right stage, final rows frozen, complete only after the time). On `offers`: `offers_guard` (starts pending, valid dates, only pending rows change, no answer after expiry) and `offers_interview_guard` (no offer while a round is still scheduled).

**12. BEFORE vs AFTER triggers — how did you choose?**
BEFORE triggers can change or reject a row before it is written: guards and `updated_at`. AFTER triggers react to a row that passed every check and was really saved: the counter, the history row and the offer withdrawal. Logging in a BEFORE trigger could record a change that is then rejected.

**13. What is a deferred constraint trigger, and why do you need one?**
`CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` runs its check at COMMIT instead of after each statement. In the make-offer transaction the status becomes `offered` before the offer row is inserted, so an immediate check would always fail. Only the final state must be consistent: if someone sets `offered` without an offer, COMMIT fails and nothing is saved.

**14. Which stored functions do you have?**
`update_application_status()` (locks the row, checks the actor, updates, notifies — atomic), `generate_hiring_pipeline_report()` (one row per job with stage counts and rates, validates its parameters), `rank_candidates_for_job()` (vector ranking + skill counts), `compute_match_score()` (stored score or NULL, never a guess), `is_valid_status_transition()` (the single transition table) and `local_today()` (today in India, because the server runs in UTC). Plus 12 trigger functions.

**15. Which views do you have, and why views?**
`recruiter_pipeline_view` (one row per job with counts per stage), `candidate_application_view` (one row per application with last change, next interview, offer) and `company_hiring_summary` (per company, `GROUP BY … HAVING count > 0`). A view is a saved SELECT: the app reuses a tested query, results are always current, and each view joins only one "many" side and uses subqueries for the rest, so counts are not multiplied.

**16. Which transactions do you use?**
Registration (users + candidates), apply to job (application + trigger effects + notification), schedule interview (interview + first-round status change + notification), make offer (status + offer + notifications), accept/decline/withdraw offer, resume upload, admin recruiter creation (users + recruiters), job create/edit/delete, every migration and the seed. If any step fails, ROLLBACK undoes all of them, including the trigger effects.

**17. Why `FOR SHARE` on the job when applying?**
Many candidates can apply at once because share locks do not block each other, but a recruiter's `UPDATE jobs SET status = 'closed'` needs a stronger lock and waits until we commit. So "check the job is open" and "insert the application" cannot be split by a concurrent close.

**18. Why `FOR NO KEY UPDATE` on resume upload, and `FOR UPDATE` elsewhere?**
On upload we lock the candidate row so two parallel first uploads cannot both become primary. `FOR NO KEY UPDATE` is the weakest lock that blocks another upload transaction, but unlike `FOR UPDATE` it does not block foreign-key checks, so the same candidate can still apply meanwhile. `FOR UPDATE` is used where we will change the locked row itself (status changes, offers, interviews), so two recruiters clicking at once are handled one after the other.

**19. Why not check "already applied?" with a SELECT first?**
Two simultaneous requests could both see "not applied" and both insert. The `UNIQUE (job_id, candidate_id)` constraint decides atomically; the second INSERT fails with error 23505 and the API returns 409. The same applies to one offer per application.

**20. How did you choose the ON DELETE rules?**
CASCADE when the child cannot exist without the parent (profiles, skills, resumes, embeddings, history, interviews, offers). RESTRICT when deleting would destroy business history (a company with recruiters or jobs, a job with applications, a skill in use). SET NULL when the child is still useful without the link (an audit row whose author was deleted, a job whose recruiter left). The admin's "delete company" sends the DELETE and lets the FK refuse it, so there is no race.

**21. Which indexes did you create?**
PostgreSQL indexes primary keys and UNIQUE constraints automatically, but not foreign keys, so we added B-tree indexes on FK columns used in joins. Partial indexes: open jobs by date (`WHERE status = 'open'`), unread notifications (`WHERE NOT is_read`), and a partial UNIQUE index allowing one primary resume per candidate. A composite index `(job_id, status)` for the pipeline per job, and HNSW indexes on both embedding columns. 46 indexes in total.

**22. How do you validate data at the database level?**
57 CHECK constraints (status values, salary range, proficiency 1–5, bcrypt-format hash, unit-length vectors, file size and type), NOT NULL, UNIQUE, 22 foreign keys, a composite FK that ties a profile to the right role, and triggers for rules that depend on time or other rows. The API validates with zod first for friendly messages, but the database is the final guard.

**23. Why no ORM?**
The course asks for visible SQL, and we wanted to show and defend every query. Raw SQL through `pg` lets us use PostgreSQL features an ORM hides (constraint triggers, `FOR SHARE`, `EXCEPT`, pgvector operators, set-returning functions). The risk of raw SQL is injection, which we avoid with parameters.

**24. How do you prevent SQL injection?**
Every value goes into a `$1, $2 …` parameter, so the database treats it as data, never as SQL. The only text built in code is from fixed column lists in our own source. A test searches for `' OR 1=1 --` and gets 0 rows.

**25. How are passwords stored, and why bcrypt?**
As bcrypt hashes with cost 12 and a random salt stored inside the hash, so the same password gives different hashes and each guess is slow. A CHECK constraint refuses anything that is not a bcrypt hash. Login runs bcrypt even for unknown emails and returns the same message, so attackers cannot tell which emails exist. Five failed attempts per email and IP in 15 minutes give 429.

**26. How does the JWT session work?**
After login, the server signs a JWT (HS256) holding only the user id and role, with issuer, audience and an 8-hour expiry, and puts it in an httpOnly, SameSite=Lax cookie (Secure in production), so page JavaScript cannot read it. On every request we verify the signature and then re-read the user from the database, so disabling an account or changing a role takes effect on the next request.

**27. Why must roles be checked on the server?**
Anyone can call the API directly with curl, bypassing the UI, so hiding a button protects nothing. Every route handler is wrapped in `withAuth({ roles })` (401 without a session, 403 for the wrong role), and ownership is part of the SQL: another user's record gives 404, another company's record 403. `update_application_status()` checks the actor again inside the database.

**28. How do you prevent CSRF?**
The cookie is `SameSite=Lax`, so browsers do not send it on cross-site POSTs. Every state-changing route also rejects a foreign `Origin` header or `Sec-Fetch-Site: cross-site/same-site`, and bodies must be JSON, which an HTML form on another site cannot send.

**29. How do you know the match scores are real?**
They are computed by PostgreSQL with `compute_match_score()` = `round(1 - (resume <=> job), 4)` at apply time, or NULL if an embedding is missing. Query Q25 recomputes every stored score from the vectors and finds the largest difference 0.0000432 (rounding only), and the integration tests compare the API's scores with SQL.

**30. What are the limitations of the project?**
Averaging chunk vectors blurs mixed resumes, and the model is English-centric; scores are relative, not percentages. HNSW only helps with more data than our seed. The login rate limiter is in one process's memory and trusts `X-Forwarded-For`, which needs a proxy. A stolen JWT stays valid until it expires. There is no email/SMS, password reset or `script-src` CSP.
