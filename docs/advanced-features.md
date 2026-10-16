# TalentMatch — Advanced SQL Features (Stages 2, 5 and 6)

Migrations: `010_updated_at_triggers.sql`, `011_application_triggers.sql`, `012_functions.sql`, `013_views.sql`.
Tests: `db/tests/stage2_advanced_tests.sql` · Queries: `db/queries/important_queries.sql` · Transaction demo: `db/demos/transaction_demo.sql`.

All outputs below are real, captured on 2026-10-09 from PostgreSQL 17.11 running on a freshly reset, migrated and seeded database.

| Requirement concept (PDF §7) | Where |
|---|---|
| Triggers | 13 triggers (010, 011) |
| Stored procedures / functions | `generate_hiring_pipeline_report`, `update_application_status`, `is_valid_status_transition` (+ trigger functions); Stage 5: `rank_candidates_for_job`; Stage 6: `compute_match_score` (016) |
| Views | `recruiter_pipeline_view`, `candidate_application_view`, `company_hiring_summary` |
| Transactions | Stage 6 **apply to job** (`src/lib/applications.js`, §7), job create/edit/delete, resume upload, `update_application_status` (atomic), seed and migrations, `transaction_demo.sql` |
| Indexing | Stage 1 (B-tree, partial, HNSW) |
| Vector similarity search | Stage 5: `rank_candidates_for_job` (migration 015), see [vector-design.md](vector-design.md); Stage 6: `compute_match_score` sets `applications.match_score` |
| Set operations | Stage 6 skill gap: `job_skills EXCEPT candidate_skills` (§8, Q24) |

---

## 1. Triggers

A **trigger** is code the database runs automatically when rows change. Because it lives in the database, it runs no matter who changes the data: the Next.js API, a psql session, or a future admin script. Nobody can "forget" to update a counter or write an audit row.

- **BEFORE** triggers run before the row is saved. They can change the row (set `updated_at`) or reject it (invalid status).
- **AFTER** triggers run once the row is saved. They react to it (update a counter, write history).

| Trigger | Table | When | Function | What it does |
|---|---|---|---|---|
| `trg_*_set_updated_at` (8) | users, companies, recruiters, candidates, jobs, applications, interviews, offers | BEFORE UPDATE | `set_updated_at()` | Sets `updated_at = now()` if any other column really changed (users ignore `last_login_at` since migration 014, jobs ignore `applicant_count`) |
| `trg_applications_applicant_count` | applications | AFTER INSERT / DELETE / UPDATE OF job_id | `maintain_applicant_count()` | +1 / −1 on `jobs.applicant_count` |
| `trg_applications_truncate_count` | applications | AFTER TRUNCATE (statement) | `reset_applicant_counts_on_truncate()` | All counts back to 0 |
| `trg_applications_initial_status` | applications | BEFORE INSERT | `guard_application_initial_status()` | New applications must start as `applied` |
| `trg_applications_status_guard` | applications | BEFORE UPDATE OF status | `guard_application_status_transition()` | Rejects invalid transitions |
| `trg_applications_status_history` | applications | AFTER INSERT / UPDATE OF status | `log_application_status_change()` | Writes `application_status_history` |

### 1.1 `updated_at` maintenance (010)

Before Stage 2 only `applications` had `updated_at`. Migration 010 adds it (with `ALTER TABLE … ADD COLUMN`) to the seven other tables whose rows get edited, and attaches one generic function:

```sql
ignored := TG_ARGV || 'updated_at';
IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
    NEW.updated_at := now();
END IF;
```

The row is turned into JSON, the ignored columns are removed, and old and new are compared:
- A **no-op UPDATE** (same values) does not change `updated_at`.
- `jobs` passes `'applicant_count'` as an argument, so a new application (which changes only the counter) is not treated as "the job posting was edited".

### 1.2 `applicant_count` (011)

| Event | Effect |
|---|---|
| INSERT application | job +1 |
| DELETE application (including ON DELETE CASCADE from a deleted candidate) | job −1 |
| UPDATE that changes `job_id` | old job −1, new job +1 |
| UPDATE that does not change `job_id` | nothing (trigger declared `UPDATE OF job_id` and re-checks the value) |
| `INSERT … ON CONFLICT DO NOTHING` that is skipped | nothing (no row inserted, so no row trigger) |
| `TRUNCATE applications` | statement trigger sets every count to 0 |

### 1.3 Allowed status transitions (011)

```
applied ──► shortlisted ──► interviewed ──► offered
   │             │               │             │
   └─────────────┴───────┬───────┴─────────────┘
                         ▼
                     rejected   (final)
```

| From \ To | applied | shortlisted | interviewed | offered | rejected |
|---|---|---|---|---|---|
| (new row) | ✅ only this | ❌ | ❌ | ❌ | ❌ |
| applied | – | ✅ | ❌ skip | ❌ skip | ✅ |
| shortlisted | ❌ back | – | ✅ | ❌ skip | ✅ |
| interviewed | ❌ back | ❌ back | – | ✅ | ✅ |
| offered | ❌ back | ❌ back | ❌ back | – | ✅ (offer withdrawn/declined) |
| rejected | ❌ | ❌ | ❌ | ❌ | – |

Setting the same status again is allowed and does nothing (no history row). The rule lives in one function, `is_valid_status_transition(old, new)`. The trigger uses it, and the test suite also uses it to check all stored history.

**Why these rules fit the real workflow:** each stage is a decision someone made (shortlist, then interview, then offer), so skipping one would mean a decision that was never recorded. A rejection can come at any point. Going backwards would make the history misleading. To "re-open" a candidate, the recruiter creates a new process rather than editing history.

### 1.4 Automatic status history (011)

`AFTER INSERT OR UPDATE OF status` writes one row per change. It is an AFTER trigger, so it only logs changes that passed the guard and were really saved.

**Who made the change, and why?** A trigger cannot see the API's parameters, so the caller puts them into two transaction-local settings, which the trigger reads:

```sql
SELECT set_config('talentmatch.actor_id', '3', true);       -- true = only for this transaction
SELECT set_config('talentmatch.status_note', 'Good SQL test score', true);
UPDATE applications SET status = 'shortlisted' WHERE application_id = 6;
```

`update_application_status()` does this automatically. For a new application, `changed_by` defaults to the candidate and the note to "Application submitted".

**Historical import mode.** The seed loads applications that are already `offered`, `interviewed` and so on, together with their real, dated history rows. If the trigger also logged those inserts, every seeded application would get a duplicate, wrongly-dated history row. The seed therefore runs `SET LOCAL talentmatch.import_mode = 'on'`, which makes only the history trigger and the initial-status guard skip. The counter and the transition guard still run. The application code never sets this switch. A fresh `reset → migrate → seed` gives exactly 31 history rows and 0 inconsistencies (see §6).

---

## 2. Stored functions

### 2.1 `generate_hiring_pipeline_report(p_company_id BIGINT = NULL, p_from DATE = NULL, p_to DATE = NULL)`

**In plain words:** "For every job, how many candidates are at each stage, what share ever got shortlisted or offered, how many days shortlisting took, and how many interviews and accepted offers there were." It can be limited to one company and/or to applications received between two dates (inclusive).

- **Returns** a table, one row per job (jobs with 0 applications included through a LEFT JOIN).
- **SQL used:** a CTE, `count(*) FILTER (WHERE …)` per stage, `avg`, `round`, `nullif` (avoids division by zero), and correlated subqueries for interviews and offers. Joining those tables directly would multiply the application rows and inflate the counts.
- **Validation:**
  - `p_from > p_to` raises `invalid_parameter_value`.
  - An unknown company raises `no_data_found`.
- `STABLE`: it only reads data.

```sql
SELECT * FROM generate_hiring_pipeline_report();                                  -- everything
SELECT * FROM generate_hiring_pipeline_report(1);                                 -- one company
SELECT * FROM generate_hiring_pipeline_report(NULL, '2026-09-01', '2026-09-30');  -- September
```

Actual output of `generate_hiring_pipeline_report()`:
```
       company_name       |              job_title               |   st   | tot | ap | sl | iv | of | rj | sl_pct | of_pct | d_sl | iv_done | acc
--------------------------+--------------------------------------+--------+-----+----+----+----+----+----+--------+--------+------+---------+-----
 Kestrel Software Labs    | Frontend Developer (React / Next.js) | open   |   3 |  1 |  1 |  1 |  0 |  0 |   66.7 |    0.0 |  6.7 |       1 |   0
 Kestrel Software Labs    | Backend Engineer (Node.js)           | open   |   2 |  1 |  0 |  0 |  0 |  1 |    0.0 |    0.0 |      |       0 |   0
 Kestrel Software Labs    | Full Stack Developer                 | draft  |   0 |  0 |  0 |  0 |  0 |  0 |        |        |      |       0 |   0
 Nimbus Analytics Pvt Ltd | Machine Learning Engineer            | open   |   4 |  0 |  1 |  1 |  1 |  1 |   75.0 |   25.0 |  6.7 |       3 |   0
 Nimbus Analytics Pvt Ltd | Data Analyst                         | open   |   3 |  2 |  1 |  0 |  0 |  0 |   33.3 |    0.0 |  9.8 |       0 |   0
 Nimbus Analytics Pvt Ltd | NLP Research Intern                  | open   |   1 |  1 |  0 |  0 |  0 |  0 |    0.0 |    0.0 |      |       0 |   0
 Orbitline Cloud Systems  | Site Reliability Engineer            | closed |   1 |  0 |  0 |  0 |  0 |  1 |    0.0 |    0.0 |      |       0 |   0
 Orbitline Cloud Systems  | DevOps Engineer                      | open   |   2 |  1 |  0 |  1 |  0 |  0 |   50.0 |    0.0 |  5.9 |       1 |   0
```
(`sl_pct` counts applications that *ever* reached shortlisted. For example, ML Engineer is 3 of 4: Aditi, Rohan and Divya. Aman was rejected straight from `applied`.)

Filtered to September 2026: Frontend 2, Backend 2, Data Analyst 2, NLP Intern 1.

### 2.2 `update_application_status(p_application_id BIGINT, p_new_status VARCHAR, p_changed_by BIGINT, p_note TEXT = NULL) RETURNS applications`

**In plain words:** "Move application X to status Y on behalf of user Z, and tell the candidate."

1. **Validate input:** unknown status raises `invalid_parameter_value`; missing application raises `no_data_found`.
2. **Lock the row** with `SELECT … FOR UPDATE`, so two recruiters clicking at the same moment are handled one after the other.
3. **Authorise** (defence in depth, the API will check too):
   - admins may update anything;
   - a recruiter only applications to their own company's jobs;
   - candidates never.

   A rule violation raises `insufficient_privilege`.
4. **Update and rely on the database rules.** The function does not repeat the transition rules. The BEFORE trigger rejects invalid moves, the AFTER trigger writes history (with actor and note), and `updated_at` is refreshed.
5. **Notify the candidate** (`notifications` row).

The whole function is **atomic**. In test T9f, an invalid transition left the status, history and notifications unchanged. Setting the same status again returns the row unchanged with a NOTICE.

Actual output (inside a rolled-back transaction):
```
SELECT application_id, status, updated_at FROM update_application_status(12, 'shortlisted', <Kavya>, 'Strong design-system portfolio');
 application_id |   status    |          updated_at
             12 | shortlisted | 2026-10-09 15:12:25.377958+00

 old_status | new_status  |   changed_by   |              note
            | applied     | Vikram Chauhan | Application submitted
 applied    | shortlisted | Kavya Menon    | Strong design-system portfolio

      type      |                          title                           |                                           message
 status_changed | Application update: Frontend Developer (React / Next.js) | Your application for Frontend Developer (React / Next.js) moved from applied to shortlisted.
```

### 2.3 `rank_candidates_for_job()`: added in Stage 5 (migration 015)
It was deferred until real resume and job embeddings existed, because writing it earlier would have meant fake scores (rule 5).
It now ranks candidates by cosine similarity between their primary resume embedding and the job embedding, with an applicants-only option and required-skill counts.
Design, real outputs and EXPLAIN ANALYZE: [vector-design.md §7–8](vector-design.md#7-how-results-are-retrieved-rank_candidates_for_job).

---

## 3. Views

A **view** is a saved SELECT. The app queries it like a table, and PostgreSQL runs the underlying query each time, so the results are always current.

**Avoiding double counting:** a job has many applications *and* many interviews. Joining both in one FROM clause produces applications × interviews rows. Each view therefore joins along only one "many" relationship and uses subqueries or LATERAL for the rest. Test T11 checks that view totals equal the base-table counts.

### 3.1 `recruiter_pipeline_view` — one row per job
Recruiter, company, counts per stage, `active_in_pipeline`, average match score, last application time, and upcoming interviews (correlated subquery).
```
 recruiter_name |       company_name       |              job_title               | job_status | tot | applied | shortlisted | interviewed | offered | rejected | active | upcoming
 Kavya Menon    | Kestrel Software Labs    | Backend Engineer (Node.js)           | open       |   2 |       1 |           0 |           0 |       0 |        1 |      1 |        0
 Kavya Menon    | Kestrel Software Labs    | Frontend Developer (React / Next.js) | open       |   3 |       1 |           1 |           1 |       0 |        0 |      3 |        1
 Kavya Menon    | Kestrel Software Labs    | Full Stack Developer                 | draft      |   0 |       0 |           0 |           0 |       0 |        0 |      0 |        0
 Arjun Rao      | Nimbus Analytics Pvt Ltd | Data Analyst                         | open       |   3 |       2 |           1 |           0 |       0 |        0 |      3 |        0
 Meera Iyer     | Nimbus Analytics Pvt Ltd | Machine Learning Engineer            | open       |   4 |       0 |           1 |           1 |       1 |        1 |      2 |        1
 Meera Iyer     | Nimbus Analytics Pvt Ltd | NLP Research Intern                  | open       |   1 |       1 |           0 |           0 |       0 |        0 |      1 |        0
 Rahul Kamath   | Orbitline Cloud Systems  | DevOps Engineer                      | open       |   2 |       1 |           0 |           1 |       0 |        0 |      2 |        0
 Rahul Kamath   | Orbitline Cloud Systems  | Site Reliability Engineer            | closed     |   1 |       0 |           0 |           0 |       0 |        1 |      0 |        0
```

### 3.2 `candidate_application_view` — one row per application
Job, company, salary, current status, the time of the last status change (LATERAL subquery), the next scheduled interview (LATERAL), and offer details (LEFT JOIN `offers`, at most one per application thanks to its UNIQUE constraint).
```
 candidate_name |         job_title         |       company_name       | application_status | status_changed_at |   next_interview_at    | offer_status | offer_salary
 Aditi Sharma   | Machine Learning Engineer | Nimbus Analytics Pvt Ltd | interviewed        | 2026-09-12        | 2026-10-14 05:30:00+00 |              |
 Rohan Verma    | Data Analyst              | Nimbus Analytics Pvt Ltd | applied            | 2026-09-06        |                        |              |
 Rohan Verma    | Machine Learning Engineer | Nimbus Analytics Pvt Ltd | offered            | 2026-10-01        |                        | pending      |   2600000.00
```

### 3.3 `company_hiring_summary` — one row per company with hiring activity
Joins companies → jobs → applications → offers. Jobs repeat once per application, so it uses `count(DISTINCT j.job_id)`. Applications and offers do not repeat, because each application has one job and at most one offer.

**HAVING** `count(a.application_id) > 0` keeps only companies that have actually received applications. With the seed, all 3 qualify. Test T11b adds a company with an empty job and confirms the view hides it, while `recruiter_pipeline_view` still lists the empty job.
```
 company_name             | total_jobs | open_jobs | total_applications | unique_candidates | avg_applications_per_job | currently_offered | rejected | rejection_rate_pct | offers_made | offers_accepted
 Nimbus Analytics Pvt Ltd |          3 |         3 |                  8 |                 6 |                     2.67 |                 1 |        1 |               12.5 |           1 |               0
 Kestrel Software Labs    |          3 |         2 |                  5 |                 5 |                     1.67 |                 0 |        1 |               20.0 |           0 |               0
 Orbitline Cloud Systems  |          2 |         1 |                  3 |                 2 |                     1.50 |                 0 |        1 |               33.3 |           0 |               0
```
`avg_match_score` is NULL in every view until Stage 5 computes real similarities.

---

## 4. Important queries

`db/queries/important_queries.sql` contains 26 commented queries. On 2026-10-16 the whole file ran with `ON_ERROR_STOP` (exit code 0, no errors).

| # | Concept(s) | Purpose | Rows |
|---|---|---|---|
| Q1 | INNER + LEFT JOIN, ORDER BY | Open jobs, newest first | 6 |
| Q2 | GROUP BY, COUNT, window `sum() OVER ()` | Applications per status with % | 5 |
| Q3 | GROUP BY + **HAVING** | Jobs with ≥ 3 applicants | 3 |
| Q4 | MIN / MAX / AVG / FILTER | Salary stats per company | 3 |
| Q5 | **NOT EXISTS** | Candidates who never applied | 0 (correct: all seeded candidates applied) |
| Q6 | **NOT EXISTS** | Open/draft jobs with no applicants | 1 (Full Stack Developer, draft) |
| Q7 | **IN (subquery)**, nested subquery | Candidates with a required ML skill | 6 |
| Q8 | **Correlated subqueries** | Required-skill coverage per applicant ("3/3") | 16 |
| Q9 | Scalar subquery | Above-average experience (avg 3.08 yrs) | 4 |
| Q10 | COUNT(DISTINCT) over two M:N tables + HAVING | Skill demand vs supply | 4 |
| Q11 | Window `LAG()` on history | Average days per transition | 4 |
| Q12 | Multi-JOIN, FILTER, ORDER BY | Recruiter workload | 4 |
| Q13 | 4-table JOIN, date filter | Upcoming interviews | 2 |
| Q14 | Correlated subquery with MAX | Each candidate's latest application | 12 |
| Q15 | JOIN, AVG, HAVING | Interview rating vs outcome (offered 4.50, interviewed 4.00) | 2 |
| Q16 | View + set-returning function | Company summary and Nimbus funnel | 3 + 3 |
| Q17 | M:N JOIN, GROUP BY + HAVING, string_agg | Skill profile per candidate | 12 |
| Q18 | Two derived-table aggregates + HAVING | Skill demand vs supply | 16 |
| Q19 | JOIN ON TRUE, LEFT JOIN, HAVING on a ratio | Required-skill coverage for open jobs | 10 |
| Q20 | pgvector function (`<=>`) | Top 5 semantic matches for ML Engineer | 5 |
| Q21 | Same, applicants only | Ranked applicants | 4 |
| Q22 | Raw k-NN `ORDER BY <=> LIMIT k` | Best open jobs for Aditi | 3 |
| Q23 | **BEGIN / FOR SHARE / INSERT … RETURNING / ROLLBACK** | Apply transaction step by step (count 3 → 4 inside, 3 after ROLLBACK) | 1 per step |
| Q24 | **EXCEPT** + JOIN | Skill gap for Aman / ML Engineer | 3 |
| Q25 | Function per row, aggregate check | Stored match scores equal `1 - (<=>)` (max diff 0.00004318) | 1 |
| Q26 | `ORDER BY … DESC NULLS LAST`, correlated `string_agg` | Ranked applicants with matched / required skills | 4 |

Q8 already shows why semantic matching is useful. Rohan (offered for ML Engineer) meets only 1 of 3 required skills by keyword, because his profile says TensorFlow rather than PyTorch, yet the interviewers rated him 5/5 and 4/5.

---

## 5. Transactions

A **transaction** groups statements so they succeed or fail together (atomicity). `BEGIN` starts one, `COMMIT` saves everything, and `ROLLBACK` undoes everything since `BEGIN`.

`db/demos/transaction_demo.sql` uses a disposable fictional candidate, `txn.demo@mail.example`:

- **Part A (COMMIT):** register (users + candidates) and apply, all in one transaction. After COMMIT, a new query sees the user, the application, the trigger-written history row, and `applicant_count` 3 → 4. The demo then deletes the disposable user: CASCADE removes everything and the trigger brings the count back to 3.
- **Part B (ROLLBACK):** the same steps for `txn.demo2`, then a deliberate duplicate application.
- **Part C (SAVEPOINT):** roll back only part of a transaction.

Actual output (abridged):
```
##### BEFORE #####           Data Analyst | 3        demo_users 0
##### PART A #####
BEGIN / INSERT 0 1 / INSERT 0 1 / INSERT 0 1 / COMMIT
 txn.demo@mail.example | Disposable demo profile | applied | Data Analyst | 4
 history:  (NULL) -> applied | Application submitted
 cleanup:  DELETE 1  ->  Data Analyst | 3
##### PART B #####
BEGIN / INSERT 0 1 / INSERT 0 1 / INSERT 0 1
 inside txn:  txn.demo2@mail.example | 4
ERROR:  duplicate key value violates unique constraint "applications_job_id_candidate_id_key"
ERROR:  current transaction is aborted, commands ignored until end of transaction block
ROLLBACK
 demo2_users 0 | demo2_candidates 0 | Data Analyst | 3
##### PART C #####
ERROR:  new row for relation "skills" violates check constraint "skills_category_check"
ROLLBACK (to savepoint)  ->  Txn Demo Skill | data   (first insert kept)
ROLLBACK                 ->  demo_skills 0
##### AFTER #####           Data Analyst | 3        demo_users 0
```

Other transactions in the project:
- Each migration runs in its own transaction (`scripts/migrate.js`).
- The seed is one transaction.
- `update_application_status()` is atomic.
- Registration (users + candidates) is an API transaction (Stage 3).
- **Apply to job** is an explicit API transaction (Stage 6, see §7).
- Job create / edit / delete lock and change `jobs` + `job_skills` in one transaction (Stage 6).
- Making an offer is still to come.

---

## 6. Test results (`db/tests/stage2_advanced_tests.sql`)

Everything runs in one transaction that is rolled back. 27 PASS lines, 0 failures. A fingerprint of the applications and jobs tables plus the history and notification counts was identical before and after the run.

```
PASS T1: applicant_count 2 -> 3, history (NULL -> applied) by candidate 9
PASS T2: applicant_count 3 -> 2
PASS T3: old job 2 -> 1 -> 2, new job 2 -> 3 -> 2
PASS T4: history row 43 : applied -> shortlisted by user 3, note "Good SQL test score"
  rejected as expected: Invalid application status transition: applied -> offered (application 12)
  rejected as expected: Invalid application status transition: applied -> interviewed (application 12)
  rejected as expected: Invalid application status transition: rejected -> shortlisted (application 5)
  rejected as expected: Invalid application status transition: offered -> interviewed (application 7)
  rejected as expected: Invalid application status transition: interviewed -> applied (application 13)
PASS T5: 5/5 invalid transitions rejected, no history rows written
PASS T6: 5 history rows for the full path; same-status update ignored
PASS T7: A new application must start with status 'applied' (got offered)
PASS T8a: jobs.updated_at 2026-01-01 -> 2026-10-09 15:13:54.411696+00 after editing openings
PASS T8b: no-op UPDATE left jobs.updated_at at 2026-01-01
PASS T8c: new application changed applicant_count but not jobs.updated_at
PASS T8d: applications.updated_at 2026-09-05 14:20:00+00 -> 2026-10-09 15:13:54.411696+00
PASS T8e: candidates.updated_at refreshed on profile edit
PASS T9a: status=interviewed history=(shortlisted -> interviewed by 4, "Technical round cleared") + 1 notification
PASS T9b: User 2 is not allowed to update application 11
PASS T9c: User 17 is not allowed to update application 11
PASS T9d: Unknown application status: hired
PASS T9e: Application 999999 does not exist
PASS T9f: Invalid application status transition: interviewed -> applied (application 11)
PASS T9g: failed call left status, history and notifications untouched
PASS T9h: admin moved application to offered
PASS T10a: 8 job rows, 17 applications total; Nimbus filter -> 3 rows
PASS T10b: Invalid date range: from (2026-10-01) is after to (2026-09-01)
PASS T10c: Company 424242 does not exist
PASS T11: all three views consistent with base tables
PASS T11b: company with 0 applications hidden by HAVING (still visible per job in recruiter_pipeline_view)
PASS T12: ML Engineer 4 -> 3, Frontend 3 -> 2
PASS T13: all applicant_count values are 0 after TRUNCATE
=== All Stage 2 tests passed; transaction rolled back (seed data unchanged) ===
```
(T10a reports 17 applications because T8c inserted one inside the same test transaction.)

**Consistency checks** after a fresh `db:reset → db:migrate → db:seed` (each expected to return 0 rows, and each did):
- jobs whose `applicant_count` differs from the real count
- applications whose latest history `new_status` differs from `applications.status`
- applications with no history
- stored history rows that break `is_valid_status_transition`

Re-running `db:seed` left a fingerprint of every job's `updated_at` and `applicant_count` unchanged.

---

## 7. Stage 6: the apply-to-job transaction

Code: `applyToJob()` in `src/lib/applications.js`, called by `POST /api/candidate/applications`. Step-by-step SQL version: Q23.

```
BEGIN
  SELECT … FROM jobs WHERE job_id = $1 FOR SHARE          -- lock the job; 404 if draft, 409 if closed
  SELECT … FROM resumes WHERE resume_id = $1 AND candidate_id = $2 FOR SHARE   -- 404 if not theirs
  INSERT INTO applications (job_id, candidate_id, resume_id, cover_letter, match_score)
  VALUES ($1, $2, $3, $4, compute_match_score($3, $1))    -- triggers fire here, inside the txn:
       --   trg_applications_initial_status   new row must be 'applied'
       --   trg_applications_applicant_count  jobs.applicant_count + 1
       --   trg_applications_status_history   (NULL -> applied) history row
  INSERT INTO notifications (…) SELECT r.user_id, 'application_submitted', … FROM recruiters r …
COMMIT                         -- everything above becomes visible at once
-- any error -> ROLLBACK: the application, the trigger's +1 and history row, and the notification all disappear
```

Design decisions (for the viva):
- **Why one transaction?** An application without its notification, or a `+1` on `applicant_count` with no application, would be inconsistent. Atomicity guarantees all four changes happen or none. The rollback test makes the last step (the notification) fail on purpose: no application row, no history row and no count change remain. The negative control below shows what happens *without* a transaction.
- **Why `FOR SHARE` on the job?** Many candidates can apply at the same time, because share locks don't block each other. But a recruiter's `UPDATE jobs SET status = 'closed'` needs a stronger lock and waits until we commit. So "check the job is open" and "insert the application" can't be split by a concurrent close.
- **Why no "already applied?" SELECT first?** Two simultaneous requests could both see "not applied" and both insert. The `UNIQUE (job_id, candidate_id)` constraint decides atomically. The second INSERT fails with `23505` and the API turns that into **409 `ALREADY_APPLIED`**.
- **Why isn't `applicant_count` updated in the API?** The AFTER INSERT trigger already does it, inside the same transaction, so it rolls back too. Updating it in two places would double count.
- **Match score.** `compute_match_score(resume_id, job_id)` (migration 016) returns `round(1 - (resume <=> job), 4)` for the resume the candidate *chose*, or **NULL** if either side isn't embedded. It never returns a guessed value. `npm run db:embed` later fills in NULL scores once both embeddings exist; migration 017 stops that from touching `applications.updated_at`.

Negative control (run on 2026-10-16, a scratch script doing the same INSERTs **without** BEGIN/ROLLBACK):
```
notification failed: notifications_title_not_blank_check
without a transaction: application rows left = 1, applicant_count 1 -> 2
```

### Status changes

`PATCH /api/recruiter/applications/:id` checks ownership in the API, then calls `update_application_status()`. The API does **not** know the workflow rules. Invalid moves are rejected by `trg_applications_status_guard`, and its `RAISE EXCEPTION … USING ERRCODE = 'check_violation'` reaches the API as `23514`. The API returns it as **409 `INVALID_TRANSITION`** with the database's own message and hint, which the UI displays as is:
```
Invalid application status transition: shortlisted -> offered (application 42)
• Allowed: applied->shortlisted|rejected, shortlisted->interviewed|rejected, interviewed->offered|rejected, offered->rejected. rejected is final.
```

## 8. Stage 6: skill gap with EXCEPT

`getSkillGap()` in `src/lib/candidate/skill-gap.js` (Q24 is the same logic in one query):
```sql
-- missing = the job's required skills MINUS the candidate's skills
SELECT js.skill_id FROM job_skills js WHERE js.job_id = $1 AND js.is_required
EXCEPT
SELECT cs.skill_id FROM candidate_skills cs WHERE cs.candidate_id = $2
```
The "have" list is the matching JOIN, with `meetsLevel = proficiency >= min_proficiency`. That's the same rule `rank_candidates_for_job()` uses for `matched_skills`, so the candidate page and the recruiter page agree. Every required skill lands in exactly one list (tested). Result for seeded Aman and the ML Engineer job: **have** Python (level 2, needs 4: below level); **missing** Natural Language Processing, PyTorch.

