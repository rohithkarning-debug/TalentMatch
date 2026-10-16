# TalentMatch — Advanced SQL Features (Stages 2 and 5–9)

Migrations: `010_updated_at_triggers.sql`, `011_application_triggers.sql`, `012_functions.sql`, `013_views.sql`.
Tests: `db/tests/stage2_advanced_tests.sql` · Queries: `db/queries/important_queries.sql` · Transaction demo: `db/demos/transaction_demo.sql`.

All outputs below are real. They were re-captured on 16 Oct 2026 from PostgreSQL 17.11 on a database rebuilt from scratch with the final migrations 001–024 and the final seed. The seed's dates are relative to the day it runs, so dates (not counts) shift if you reseed on another day.

| Requirement concept (PDF §7) | Where |
|---|---|
| Triggers | 13 triggers (010, 011); Stage 7: `trg_interviews_guard`, `trg_offers_guard` and the **deferred constraint trigger** `trg_applications_stage_records` (018, 019; §9); Stage 9: `trg_applications_withdraw_offer` (020), the completion rule in `trg_interviews_guard` (021) `trg_applications_accepted_offer_guard` (022; §14); Stage 10: `trg_offers_interview_guard` (023; §14). 19 in total |
| Stored procedures / functions | `generate_hiring_pipeline_report`, `update_application_status`, `is_valid_status_transition` (+ trigger functions); Stage 5: `rank_candidates_for_job`; Stage 6: `compute_match_score` (016) |
| Views | `recruiter_pipeline_view`, `candidate_application_view`, `company_hiring_summary` |
| Transactions | Stage 7 **make offer**, accept/decline, withdraw, **schedule interview** (§10, §11; Q27, Q28), Stage 6 **apply to job** (`src/lib/applications.js`, §7), job create/edit/delete, resume upload, `update_application_status` (atomic), seed and migrations, `transaction_demo.sql` |
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

**Historical import mode.** The seed loads applications that are already `offered`, `interviewed` and so on, together with their real, dated history rows. If the trigger also logged those inserts, every seeded application would get a duplicate, wrongly-dated history row. The seed therefore runs `SET LOCAL talentmatch.import_mode = 'on'`, which makes only the history trigger and the initial-status guard skip. The counter and the transition guard still run. The application code never sets this switch. A fresh `reset → migrate → seed` gives exactly 40 history rows and 0 inconsistencies (see §6).

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
 Kestrel Software Labs    | Full Stack Developer                 | draft  |   0 |  0 |  0 |  0 |  0 |  0 |        |        |      |       0 |   0
 Kestrel Software Labs    | Backend Engineer (Node.js)           | open   |   3 |  1 |  0 |  0 |  0 |  2 |   33.3 |   33.3 |  5.6 |       1 |   0
 Kestrel Software Labs    | Frontend Developer (React / Next.js) | open   |   3 |  1 |  1 |  1 |  0 |  0 |   66.7 |    0.0 |  6.7 |       1 |   0
 Nimbus Analytics Pvt Ltd | NLP Research Intern                  | open   |   1 |  1 |  0 |  0 |  0 |  0 |    0.0 |    0.0 |      |       0 |   0
 Nimbus Analytics Pvt Ltd | Data Analyst                         | open   |   3 |  2 |  1 |  0 |  0 |  0 |   33.3 |    0.0 |  9.8 |       0 |   0
 Nimbus Analytics Pvt Ltd | Machine Learning Engineer            | open   |   4 |  0 |  1 |  1 |  1 |  1 |   75.0 |   25.0 |  6.7 |       3 |   0
 Orbitline Cloud Systems  | Site Reliability Engineer            | closed |   2 |  0 |  0 |  0 |  1 |  1 |   50.0 |   50.0 |  5.0 |       1 |   1
 Orbitline Cloud Systems  | DevOps Engineer                      | open   |   2 |  1 |  0 |  1 |  0 |  0 |   50.0 |    0.0 |  5.9 |       1 |   0
```
(`sl_pct` counts applications that *ever* reached shortlisted. For example, ML Engineer is 3 of 4: Aditi, Rohan and Divya. Aman was rejected straight from `applied`.)

Filtered to September 2026 (`'2026-09-01'` to `'2026-09-30'`): Frontend 3, Backend 3, Data Analyst 3, Machine Learning Engineer 2, NLP Intern 1, DevOps 1.

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
SELECT application_id, status, updated_at FROM update_application_status(13, 'shortlisted', <Kavya>, 'Strong design-system portfolio');
 application_id |   status    |          updated_at
             13 | shortlisted | 2026-10-16 16:24:37.314739+00

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
 Kavya Menon    | Kestrel Software Labs    | Backend Engineer (Node.js)           | open       |   3 |       1 |           0 |           0 |       0 |        2 |      1 |        0
 Kavya Menon    | Kestrel Software Labs    | Frontend Developer (React / Next.js) | open       |   3 |       1 |           1 |           1 |       0 |        0 |      3 |        1
 Kavya Menon    | Kestrel Software Labs    | Full Stack Developer                 | draft      |   0 |       0 |           0 |           0 |       0 |        0 |      0 |        0
 Arjun Rao      | Nimbus Analytics Pvt Ltd | Data Analyst                         | open       |   3 |       2 |           1 |           0 |       0 |        0 |      3 |        0
 Meera Iyer     | Nimbus Analytics Pvt Ltd | Machine Learning Engineer            | open       |   4 |       0 |           1 |           1 |       1 |        1 |      2 |        1
 Meera Iyer     | Nimbus Analytics Pvt Ltd | NLP Research Intern                  | open       |   1 |       1 |           0 |           0 |       0 |        0 |      1 |        0
 Rahul Kamath   | Orbitline Cloud Systems  | DevOps Engineer                      | open       |   2 |       1 |           0 |           1 |       0 |        0 |      2 |        0
 Rahul Kamath   | Orbitline Cloud Systems  | Site Reliability Engineer            | closed     |   2 |       0 |           0 |           0 |       1 |        1 |      0 |        0
```

### 3.2 `candidate_application_view` — one row per application
Job, company, salary, current status, the time of the last status change (LATERAL subquery), the next scheduled interview (LATERAL), and offer details (LEFT JOIN `offers`, at most one per application thanks to its UNIQUE constraint).
```
 candidate_name |         job_title         |       company_name       | application_status | status_changed_at |   next_interview_at    | offer_status | offer_salary
 Aditi Sharma   | Machine Learning Engineer | Nimbus Analytics Pvt Ltd | interviewed        | 2026-09-20        | 2026-10-22 05:30:00+00 |              |
 Rohan Verma    | Data Analyst              | Nimbus Analytics Pvt Ltd | applied            | 2026-09-14        |                        |              |
 Rohan Verma    | Machine Learning Engineer | Nimbus Analytics Pvt Ltd | offered            | 2026-10-09        |                        | pending      |   2600000.00
```

### 3.3 `company_hiring_summary` — one row per company with hiring activity
Joins companies → jobs → applications → offers. Jobs repeat once per application, so it uses `count(DISTINCT j.job_id)`. Applications and offers do not repeat, because each application has one job and at most one offer.

**HAVING** `count(a.application_id) > 0` keeps only companies that have actually received applications. With the seed, all 3 qualify. Test T11b adds a company with an empty job and confirms the view hides it, while `recruiter_pipeline_view` still lists the empty job.
```
 company_name             | total_jobs | open_jobs | total_applications | unique_candidates | avg_applications_per_job | currently_offered | rejected | rejection_rate_pct | offers_made | offers_accepted
 Nimbus Analytics Pvt Ltd |          3 |         3 |                  8 |                 6 |                     2.67 |                 1 |        1 |               12.5 |           1 |               0
 Kestrel Software Labs    |          3 |         2 |                  6 |                 5 |                     2.00 |                 0 |        2 |               33.3 |           1 |               0
 Orbitline Cloud Systems  |          2 |         1 |                  4 |                 2 |                     2.00 |                 1 |        1 |               25.0 |           1 |               1
```
`avg_match_score` (not shown above) is the average of the real cosine scores; it is NULL only for jobs whose applications are not scored yet.

---

## 4. Important queries

`db/queries/important_queries.sql` contains 41 commented queries: Q1–Q26 below, Q27–Q32 from Stage 7 (§10–11) and Q33–Q41 from Stage 8 (§12). In the final run (16 Oct 2026) the whole file ran with `ON_ERROR_STOP=1`: exit code 0, no errors. The row counts below are from that run.

| # | Concept(s) | Purpose | Rows |
|---|---|---|---|
| Q1 | INNER + LEFT JOIN, ORDER BY | Open jobs, newest first | 6 |
| Q2 | GROUP BY, COUNT, window `sum() OVER ()` | Applications per status with % | 5 |
| Q3 | GROUP BY + **HAVING** | Jobs with ≥ 3 applicants | 4 |
| Q4 | MIN / MAX / AVG / FILTER | Salary stats per company | 3 |
| Q5 | **NOT EXISTS** | Candidates who never applied | 0 (correct: all seeded candidates applied) |
| Q6 | **NOT EXISTS** | Open/draft jobs with no applicants | 1 (Full Stack Developer, draft) |
| Q7 | **IN (subquery)**, nested subquery | Candidates with a required ML skill | 6 |
| Q8 | **Correlated subqueries** | Required-skill coverage per applicant ("3/3") | 18 |
| Q9 | Scalar subquery | Above-average experience (avg 3.08 yrs) | 4 |
| Q10 | COUNT(DISTINCT) over two M:N tables + HAVING | Skill demand vs supply | 4 |
| Q11 | Window `LAG()` on history | Average days per transition | 5 |
| Q12 | Multi-JOIN, FILTER, ORDER BY | Recruiter workload | 4 |
| Q13 | 4-table JOIN, date filter | Upcoming interviews | 2 |
| Q14 | Correlated subquery with MAX | Each candidate's latest application | 12 |
| Q15 | JOIN, AVG, HAVING | Interview rating vs outcome (offered 4.67, interviewed 4.00, rejected 4.00) | 3 |
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
- Making an offer, scheduling an interview and answering or withdrawing an offer are API transactions too (Stage 7, §10–11); so is creating a recruiter account (Stage 8, §13).

---

## 6. Test results (`db/tests/stage2_advanced_tests.sql`)

Everything runs in transactions that are rolled back. 27 PASS lines, 0 failures. (Stage 9: T13 now runs in its own transaction. Since migration 018, the earlier tests queue events for the deferred `trg_applications_stage_records`, and PostgreSQL refuses `TRUNCATE` while trigger events are pending. Re-run on 2026-10-16: 27 PASS, see [test-cases.md](test-cases.md).) A fingerprint of the applications and jobs tables plus the history and notification counts was identical before and after the run.

```
PASS T1: applicant_count 3 -> 4, history (NULL -> applied) by candidate 9
PASS T2: applicant_count 4 -> 3
PASS T3: old job 2 -> 1 -> 2, new job 3 -> 4 -> 3
PASS T4: history row 58 : applied -> shortlisted by user 3, note "Good SQL test score"
  rejected as expected: Invalid application status transition: applied -> offered (application 13)
  rejected as expected: Invalid application status transition: applied -> interviewed (application 13)
  rejected as expected: Invalid application status transition: rejected -> shortlisted (application 5)
  rejected as expected: Invalid application status transition: offered -> interviewed (application 7)
  rejected as expected: Invalid application status transition: interviewed -> applied (application 14)
PASS T5: 5/5 invalid transitions rejected, no history rows written
PASS T6: 5 history rows for the full path; same-status update ignored
PASS T7: A new application must start with status 'applied' (got offered)
PASS T8a: jobs.updated_at 2026-01-01 -> 2026-10-16 16:24:30.682998+00 after editing openings
PASS T8b: no-op UPDATE left jobs.updated_at at 2026-01-01
PASS T8c: new application changed applicant_count but not jobs.updated_at
PASS T8d: applications.updated_at 2026-09-13 14:20:00+00 -> 2026-10-16 16:24:30.682998+00
PASS T8e: candidates.updated_at refreshed on profile edit
PASS T9a: status=interviewed history=(shortlisted -> interviewed by 4, "Technical round cleared") + 1 notification
PASS T9b: User 2 is not allowed to update application 12
PASS T9c: User 17 is not allowed to update application 12
PASS T9d: Unknown application status: hired
PASS T9e: Application 999999 does not exist
PASS T9f: Invalid application status transition: interviewed -> applied (application 12)
PASS T9g: failed call left status, history and notifications untouched
PASS T9h: admin moved application to offered
PASS T10a: 8 job rows, 19 applications total; Nimbus filter -> 3 rows
PASS T10b: Invalid date range: from (2026-10-01) is after to (2026-09-01)
PASS T10c: Company 424242 does not exist
PASS T11: all three views consistent with base tables
PASS T11b: company with 0 applications hidden by HAVING (still visible per job in recruiter_pipeline_view)
PASS T12: ML Engineer 4 -> 3, Frontend 3 -> 2
PASS T13: all applicant_count values are 0 after TRUNCATE
=== All Stage 2 tests passed; transactions rolled back (seed data unchanged) ===
```
(T10a reports 19 applications because T8c inserted one inside the same test transaction; the seed has 18.)

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

---

## 9. Stage 7: database rules for interviews and offers (migrations 018, 019)

| Object | Kind | Rule |
|---|---|---|
| `notifications_type_check` | CHECK (dropped and re-added with `ALTER TABLE`) | Adds `interview_updated`, `offer_responded`, `offer_withdrawn` |
| `interviews_location_required_check` | CHECK (added with `ALTER TABLE`) | Video and onsite interviews need a link or location; phone may leave it empty |
| `local_today()` | SQL function, `STABLE` | `(now() AT TIME ZONE 'Asia/Kolkata')::date`. The server runs in UTC, but offer dates are Indian calendar dates. Between 00:00 and 05:30 IST, `current_date` would still be "yesterday" |
| `trg_interviews_guard` | BEFORE INSERT OR UPDATE | INSERT: status `scheduled`, `scheduled_at > now()`, application `shortlisted` or `interviewed`. UPDATE: only a `scheduled` row may change at all (019); a reschedule must be in the future; `completed` / `no_show` only once `scheduled_at <= now()` (021, §14) |
| `trg_offers_guard` | BEFORE INSERT OR UPDATE | INSERT: `pending`, joining after today, expiry not past. UPDATE: only a `pending` row may change (019); accept/decline only if `expires_on >= local_today()` and the application is `offered` |
| `trg_applications_stage_records` | **CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED** | At COMMIT: an application that became `interviewed` must have an interview, and one that became `offered` must have a pending offer |

**Why a trigger and not a CHECK for "in the future"?** A CHECK constraint has to give the same answer forever, because PostgreSQL re-checks it when a dump is restored. `scheduled_at > now()` becomes false tomorrow for every row. The trigger checks it only at the moment of INSERT or reschedule. The seeded past interviews are imported with `talentmatch.import_mode = 'on'` (as in 011). Updates are never exempt.

**Why deferred?** A normal trigger checks right after each statement. Inside the offer transaction, the status changes *before* the offer row exists (see §10), so an immediate check would always fail. `DEFERRABLE INITIALLY DEFERRED` moves the check to COMMIT, where only the final state must be consistent. A recruiter using the plain status dropdown to set `offered` without an offer is refused at COMMIT, and nothing is saved. The function re-reads the current status instead of trusting `NEW`, because the row may have changed again later in the same transaction (offered → rejected). Q29 shows it with `SET CONSTRAINTS … IMMEDIATE`:
```
NOTICE:  UPDATE shortlisted -> interviewed accepted for now (check deferred to COMMIT)
NOTICE:  deferred check: Application 3 cannot be interviewed without an interview; schedule one instead
```

**Bug found by the tests (fixed in 019).** The 018 guards only rejected a *change* of status. Setting the same final status again (`withdrawn → withdrawn`) passed. Withdrawing an offer twice returned 200 and notified the candidate a second time. A row trigger cannot tell `SET status = 'withdrawn'` from any other UPDATE of the row, so 019 makes final rows frozen: no UPDATE at all. 018 had already been applied, so the functions are replaced in a new migration rather than edited.

**How trigger errors reach the user.** Every guard uses `RAISE EXCEPTION '<readable text>' USING ERRCODE = 'check_violation'`. That arrives in Node as `23514` **without** a constraint name (a real CHECK always has one). `src/lib/api/db-rules.js` turns it into **409** with the database's own message (`INVALID_TRANSITION` for the transition guard, `RULE_VIOLATION` otherwise). A real CHECK violation stays **400** with the constraint name.

## 10. Stage 7: the make-offer transaction

Code: `makeOffer()` in `src/lib/offers.js` (`POST /api/recruiter/applications/:id/offer`). The same steps in SQL: Q27.
```
BEGIN
  SELECT … FROM applications a JOIN jobs j … WHERE a.application_id = $1 FOR UPDATE OF a   -- 404 / 403 (other company)
  SELECT update_application_status($1, 'offered', $recruiter, 'Offer made')
       --   trg_applications_status_guard   ONLY interviewed -> offered (applied -> offered fails here)
       --   trg_applications_status_history audit row (changed_by = recruiter)
       --   the function's own 'status_changed' notification
  INSERT INTO offers (application_id, salary_offered, currency, joining_date, expires_on) … RETURNING …
       --   UNIQUE (application_id): one offer per application
       --   trg_offers_guard: joining after today, expiry not in the past
  INSERT INTO notifications (…, 'offer_made', …)
COMMIT   -- deferred trg_applications_stage_records: 'offered' has a pending offer
-- any error -> ROLLBACK: status, history row, both notifications and the offer all disappear
```

Design decisions (for the viva):
- **Why is the status changed first?** The transition rule (only `interviewed → offered`) is the most important check, so it runs before any offer row exists. The deferred trigger only checks the final state at COMMIT, which makes the order free.
- **Why no "already has an offer?" SELECT first?** Two recruiters could click at the same moment. The UNIQUE constraint decides atomically. The second INSERT fails with `23505 offers_application_id_key`, and the API returns **409 `OFFER_EXISTS`**.
- **Proof of atomicity (Q28, real output).** A UNIQUE violation *after* the status change undoes the status change, the trigger's history row and the function's notification:
  ```
  NOTICE:  before: status=interviewed history=3 notifications=1
  NOTICE:  inside: status=offered history=4 notifications=2
  NOTICE:  error:  duplicate key value violates unique constraint "offers_application_id_key"
  NOTICE:  after:  status=interviewed history=3 notifications=1
  ```
  The integration tests check the same through the API, plus a failure at the very last step (a blank notification title, `notifications_title_not_blank_check`).
- **Accept / decline** (`respondToOffer()`): one transaction that locks the offer (`FOR UPDATE`), updates `status` + `responded_at` and notifies the recruiters. The lookup has `AND a.candidate_id = $2`, so another candidate's offer is **404**: we do not even reveal it exists. The trigger rejects expired offers. The recruiters notified are the job's poster **and** the recruiter who made the offer. The offer maker is not stored on the offer; it is `changed_by` of the `→ offered` history row the trigger wrote. (Found in the browser check: Meera made an offer on Arjun's job and was never told it was accepted.)
- **Withdraw** (`withdrawOffer()`): offer → `withdrawn` **and** application `offered → rejected` through `update_application_status()` (the 011 transition rule already allows it), plus an `offer_withdrawn` notification, in one transaction. Otherwise the pipeline would keep showing the candidate as "offered".
- **Decline does not change the application status.** `update_application_status()` refuses candidates as actors (Stage 2 rule), so the application stays `offered` with a `declined` offer. The recruiter can then reject it.

## 11. Stage 7: scheduling an interview

`scheduleInterview()` in `src/lib/interviews.js` (`POST /api/recruiter/applications/:id/interviews`):
```
BEGIN
  lock the application (FOR UPDATE), check the recruiter's company
  round_no = coalesce(max(round_no), 0) + 1        -- safe: the row lock serialises two schedulers
  INSERT INTO interviews …                          -- trg_interviews_guard: future, shortlisted/interviewed
  first interview only: update_application_status($1, 'interviewed', …)   -- history + status notification
  INSERT INTO notifications (…, 'interview_scheduled', …)                  -- date shown in IST
COMMIT
```
Reschedule, cancel and complete (`updateInterview()`) are one transaction each: lock the interview, UPDATE, and for reschedule/cancel an `interview_updated` notification. Rating and feedback are internal. `GET /api/candidate/interviews` does not select them (Q30). Q31 is an interview scorecard (average rating per candidate with `GROUP BY … HAVING avg(rating) >= 4`), and Q32 shows each offer's response window with `local_today()` plus unread notifications per user.

**Notifications inbox.** Every query has `WHERE user_id = <session user>`. Marking as read is `UPDATE … WHERE notification_id = $1 AND user_id = $2`, so ownership is part of the UPDATE itself. Someone else's notification matches 0 rows and gets the same **404** as a missing one. The unread count uses the partial index `notifications_unread_idx … WHERE NOT is_read` from Stage 1.


## 12. Stage 8: admin dashboard (views and the report function in use)

`GET /api/admin/dashboard` (`src/lib/admin/dashboard.js`) runs seven queries **in parallel** (`Promise.all`, each on its own pooled connection) and returns everything the `/admin` page draws. Nothing is computed in JavaScript: the page only formats numbers. Queries Q33–Q39 in `db/queries/important_queries.sql` are the same SQL.

| Dashboard part | Where the numbers come from | SQL concepts |
|---|---|---|
| KPI cards (candidates, recruiters, companies, open jobs, applications, offers; interviews as a hint) | Q33: eight scalar subqueries in one row | scalar subquery, COUNT |
| Applications by stage | Q34: `unnest(ARRAY[...]) WITH ORDINALITY` LEFT JOIN `applications` | **GROUP BY**, LEFT JOIN keeps 0-count stages, funnel ORDER BY |
| Top demanded skills | Q35: `job_skills ⋈ jobs ⋈ skills` for open jobs | **GROUP BY + HAVING count(*) >= 2**, FILTER |
| Average match score by outcome | Q36: **`candidate_application_view`** grouped by `application_status` | view, GROUP BY, `avg()` ignores NULL, `count(col)` vs `count(*)` |
| Companies table | Q37: `companies` LEFT JOIN **`company_hiring_summary`** + two pre-aggregated derived tables (offers, interview ratings) | view, derived tables, `nullif` against ÷0, **scalar subquery** for "above average" |
| Applications per job | Q39: **`generate_hiring_pipeline_report()`** in FROM | set-returning stored function |
| Recruiter workload (on `/admin/recruiters`) | **`recruiter_pipeline_view`** re-aggregated with `GROUP BY recruiter_id` | view, GROUP BY, FILTER, SUM |

**Why LEFT JOIN `company_hiring_summary` instead of FROM it?** The view's `HAVING count(a.application_id) > 0` (Stage 2) hides companies that have no applications yet. The admin must still see them in the table, so `companies` is the driving table and the view only fills in the totals (`coalesce(..., 0)`).

**Why derived tables for offers and ratings?** Joining `offers` and `interviews` directly to the applications of a company would multiply rows (applications × interviews), the same double-counting problem the views avoid (§3). Each derived table is grouped by `company_id` first, so it joins at most one row per company.

**Definitions shown on the page** (so the numbers can be defended):
- *Offer acceptance rate* = accepted ÷ (accepted + declined). Pending and withdrawn offers have no decision, so they are excluded. Seed (since Stage 9): Orbitline 1 accepted → **100%**, Kestrel 1 declined → **0%**, Nimbus has only a pending offer → "awaiting reply" instead of a misleading 0%.
- *Above average* = the company's applications > the average over **all** companies (including those with none): 18 ÷ 3 = 6, so only Nimbus (8) is marked (Kestrel has exactly 6, which is not above).
- *Average match score by outcome* uses the **current** status. Seed result (Stage 9): interviewed 0.8053, shortlisted 0.6546, applied 0.648, rejected 0.5814, offered 0.5408. Before Stage 9 the rejected group scored lowest, but adding the two finished hiring stories (Neha's DevOps resume against the SRE job, Aman's MERN resume against the Node.js job) moved `offered` below `rejected`. With 2–6 applications per group the order is not stable, so it is **not** evidence that similarity predicts progress; the page rightly says "indicative only".

**Verification.** `tests/integration/admin.test.js` recomputes every number from the **base tables** with independent SQL (no views, no function) and compares it with the API response: totals, all 5 stages, each top skill's counts, all 5 score averages (to 4 decimals), every company's 9 columns plus the above-average flag, and the stage counts of every job.

## 13. Stage 8: admin transactions and foreign-key rules

**Creating a recruiter account** (`createRecruiter()` in `src/lib/admin/recruiters.js`):
```
bcrypt hash (cost 12)                   -- before BEGIN: slow work must not hold a connection
BEGIN
  INSERT INTO users (…, role = 'recruiter') RETURNING user_id
  INSERT INTO recruiters (user_id, company_id, …)   -- FK to users (user_id, role) AND companies
COMMIT                                   -- any error -> ROLLBACK: no login without a profile
```
The role is a constant in the SQL; the strict zod schema rejects a `role` field in the body. Two failures are tested: an unknown company (the recruiters INSERT fails on `recruiters_company_fkey`) and an error forced right after the users INSERT through a test hook. Both leave **no** users row. Evidence that the first INSERT really ran: the identity sequence `users_user_id_seq` moved forward, because sequence values are never rolled back. Q40 shows the same in psql (`users_inside_tx 1`, `users_after_rollback 0`).

**Deactivating** is one UPDATE: `users.is_active = false`. No session table is needed. `loadSessionUser()` (Stage 3) re-reads `users` on every request and returns null for an inactive account, so the recruiter's existing, correctly signed JWT gets **401** on its next request, and login answers **403 `ACCOUNT_DISABLED`**. Their jobs, interviews and history stay, because deactivation is a soft delete.

**Deleting a company.** The app sends `DELETE FROM companies WHERE company_id = $1` with **no pre-check**. `recruiters_company_fkey` and `jobs_company_fkey` are `ON DELETE RESTRICT`, so PostgreSQL itself refuses (error `23503`). Only then does the app count the recruiters and jobs to build the message *"Nimbus Analytics Pvt Ltd cannot be deleted because it still has 2 recruiters and 3 jobs."* (409 `COMPANY_IN_USE`, with the constraint name). A pre-check in the app could race with a recruiter being added at the same moment; the FK cannot.

**Moving a recruiter to another company** is blocked by the database while they own jobs. `jobs (recruiter_id, company_id)` is a composite FK to `recruiters (user_id, company_id)` with no ON UPDATE action, so changing `recruiters.company_id` would leave the jobs pointing at a (recruiter, company) pair that no longer exists. PostgreSQL refuses (`jobs_recruiter_fkey`), and the API returns 409 `RECRUITER_OWNS_JOBS`. A recruiter with no jobs can be moved.

## 14. Stages 9–10: consistency fixes (migrations 020–024)

Two gaps flagged in Stage 7 are now closed **in the database**, so they hold for the API, `update_application_status()` from psql, and plain SQL alike.

| Object | Kind | Rule |
|---|---|---|
| `trg_applications_withdraw_offer` → `withdraw_pending_offer_on_reject()` | AFTER UPDATE OF status ON applications, `WHEN (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected')` | The application's **pending** offer becomes `withdrawn` and the candidate gets one `offer_withdrawn` notification, in the same transaction as the reject. Accepted / declined offers are left alone (they record the candidate's decision) |
| `trg_interviews_guard` (function replaced in 021) | BEFORE UPDATE (new rule) | `completed` or `no_show` only when `scheduled_at <= now()`; the time cannot be changed in the same UPDATE that records the outcome |
| `trg_applications_accepted_offer_guard` → `guard_reject_after_accepted_offer()` (022) | BEFORE UPDATE OF status ON applications, `WHEN (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected')` | An application whose offer was **accepted** cannot be rejected. The API answers 409 `RULE_VIOLATION` "Application N cannot be rejected: the candidate accepted its offer on 16 Oct 2026" (date format since 024) |
| `trg_offers_interview_guard` → `guard_offer_while_interview_scheduled()` (023, Stage 10) | BEFORE INSERT ON offers | No new offer while any interview of the application is still `scheduled`. The API answers 409 `RULE_VIOLATION` "Complete or cancel the scheduled interview before making an offer." with the round and its time as the hint. Found in the Stage 10 walkthrough: an offer could be made and accepted while round 2 was still pending. Unlike `trg_offers_guard`, the seed import is not exempt |
| 024 (Stage 10) | `CREATE OR REPLACE FUNCTION` for `guard_reject_after_accepted_offer()` and `guard_offer_change()` | Same rules as 019 and 022; only the dates in their messages now use the app's display format (`16 Oct 2026`) |

**Why a trigger and not code in the API route?** Rejecting can happen through the status dropdown (PATCH route), `update_application_status()` called from psql, or a direct `UPDATE`. A rule in one route would miss the other two. The trigger runs inside the transaction of whatever changed the status: if the reject rolls back, the withdrawal rolls back too (integration test "update_application_status() from SQL does the same; a ROLLBACK undoes both").

**Why AFTER and not BEFORE?** The offer should only be withdrawn if the status change really happened. AFTER row triggers only see rows that passed every BEFORE check (including the transition guard) and were actually written.

**No double notification with `withdrawOffer()`.** The recruiter's Withdraw button (`src/lib/offers.js`) first sets the offer to `withdrawn` and then rejects the application. When the trigger fires, nothing is pending any more, so it does nothing and the candidate still gets exactly one `offer_withdrawn`.

**Why also `no_show`?** Both `completed` and `no_show` describe what happened at the interview time, so neither can be true before it. `cancelled` stays allowed at any time. The second rule (no reschedule + complete in one statement) closes the loophole `UPDATE … SET scheduled_at = now() - interval '1 hour', status = 'completed'`, which would otherwise pass because the time check would see the new, past time.

**Why BEFORE for 022?** The change has to be refused before the row is written, so nothing else runs: no history row, no 020 withdrawal, no notification. An accepted offer is frozen (019), so the application that points at it must not contradict it either. Pending offers (withdrawn by 020) and declined offers (closed out by the recruiter) can still be rejected.

**Why not a CHECK constraint?** Same reason as 018: `scheduled_at <= now()` changes its answer over time, so it can only be checked at the moment of the change.

**Evidence.** Negative controls on 2026-10-16: with `trg_applications_withdraw_offer` dropped, the two reject tests failed (29 pass / 2 fail). With the 019 version of `guard_interview_change()` restored, the two completion tests failed (30 pass / 2 fail). With the migrations in place, all 32 pipeline tests passed then; with the two migration 023 tests added in Stage 10, `pipeline.test.js` has 36 tests and all pass in the final run (147 integration tests in total). After a fresh reset and seed, these SQL checks all return 0: pending offers on rejected applications, completed / no_show interviews in the future, offered applications without an offer.

**Demo data.** The seed now has one **accepted** offer (Neha Bhatt, Site Reliability Engineer, Orbitline) and one **declined** offer (Aman Malhotra, Backend Engineer, Kestrel; the recruiter then rejected the application, which leaves the declined offer unchanged). There is no `hired` status, so an accepted offer leaves the application at `offered`, exactly as the accept transaction does in the app.
