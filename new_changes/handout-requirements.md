# TalentMatch — Course Requirements, Answered

This document goes through every requirement in the course handout, *DBMS Experiential Learning – Level 3 Project Requirements* (`docs/reference/DBMS Level 3 Project Requirements.pdf`), in the handout's own order (§1–§18). Each requirement is quoted in short, followed by how TalentMatch meets it and where the evidence is in this repository.

Team: **Rohith Karning** (PES1UG24AM229) and **Saanvi Maharana** (PES1UG24AM237), Section D.

| § | Requirement | Status |
|---|---|---|
| 1 | Project title | Met |
| 2 | Team formation | Met |
| 3 | Database requirement | Met (Option 2: SQL + Vector Database) |
| 4 | Database design | Met |
| 5 | SQL implementation (DDL) | Met |
| 6 | Database operations (DML) | Met |
| 7 | Advanced database features | Met (5 SQL + vector search) |
| 8 | Vector database / semantic search | Met |
| 9 | Web application interface | Met |
| 10 | Database–application integration | Met |
| 11 | Authentication and authorization | Met (3 roles) |
| 12 | Data validation and integrity | Met |
| 13 | Security | Met |
| 14 | Project documentation | Met (14 sections) |
| 15 | Git/GitHub | Met |
| 16 | Evaluation / demonstration | Ready |
| 17 | Originality | Met |
| 18 | Level 3 expectation | Met |

---

## §1 Project Title

> *Each team must identify a unique project title… should address a meaningful real-world problem and should not be a simple CRUD application.*

**Title:** TalentMatch — AI-Assisted Resume-to-Job Matching and Recruitment Management System.

**Real-world problem:** recruiters shortlist resumes by hand or by keyword search, which is slow and misses candidates who describe the same experience in different words; simple applicant-tracking tools also let the hiring workflow become inconsistent (an application jumping from "applied" to "offered", an offer existing for a rejected candidate).

**Why it is not CRUD:** candidates are ranked by semantic similarity (pgvector); the hiring pipeline is a state machine enforced by database triggers; multi-step operations are transactions; admins get analytics built on views and a report function.

Evidence: `docs/project-report.md` §1, `docs/reference/TalentMatch_Synopsis.docx`.

## §2 Team Formation

> *2-member teams… each team member must have clearly defined responsibilities and contribute to both database and application development.*

| Member | Responsibilities |
|---|---|
| Rohith Karning | Project setup; schema and migrations; seed data; triggers, functions, views, transactions; authentication and RBAC; semantic matching with pgvector; recruiter module; interviews, offers, notifications; admin dashboard; security hardening; tests; documentation |
| Saanvi Maharana | Candidate module: profile, skills and resume API routes (database queries and validation) and the candidate dashboard UI; first candidate integration tests |

Evidence: `docs/project-report.md` §15; git history (feature branches merged by pull request).

## §3 Database Requirement

> *Option 1: SQL + NoSQL… Option 2: SQL + Vector Database (PostgreSQL with pgvector, Qdrant, Pinecone, Chroma, etc.)*

TalentMatch uses **Option 2: SQL + Vector Database**.

| Paradigm | Technology | What it stores |
|---|---|---|
| SQL (mandatory) | PostgreSQL 17 | 16 relational tables: users, companies, recruiters, candidates, skills, candidate_skills, jobs, job_skills, resumes, applications, application_status_history, interviews, offers, notifications, resume_embeddings, job_embeddings |
| Vector database | pgvector 0.8.7 (in the same PostgreSQL instance) | 384-dimensional embeddings of resumes and job descriptions, searched by cosine similarity with an HNSW index |

Evidence: `db/migrations/001_enable_extensions.sql` (`CREATE EXTENSION IF NOT EXISTS vector;`), `db/migrations/007_vector_embeddings.sql`, `docker-compose.yml` (`pgvector/pgvector` image).

## §4 Database Design

> *ER diagram converted into a relational schema… identify entities/tables, attributes, primary keys, foreign keys, relationships, appropriate constraints. For NoSQL/vector components, document the data model, collections/documents, indexes, embeddings, metadata, and retrieval strategy.*

**ER diagram:** `docs/er-diagram.png` (source: `docs/er-diagram.md`).

**Relational schema:** `docs/relational-schema.md`; column-level data dictionary: `docs/data-dictionary.md`.

| Item | TalentMatch |
|---|---|
| Entities / tables | 16 tables |
| Primary keys | 16 (composite keys on `candidate_skills` and `job_skills`) |
| Foreign keys | 22, each with a chosen `ON DELETE` rule (CASCADE / RESTRICT / SET NULL) |
| Relationships | Specialisation users → recruiters / candidates; M:N candidates↔jobs (applications), candidates↔skills, jobs↔skills; 1:N application → interviews / status history; 1:0..1 application → offer; 1:0..1 resume/job → embedding |
| Constraints | 57 CHECK, 8 UNIQUE, NOT NULL, DEFAULT, 1 deferred constraint trigger |

**Vector data model:**

| Aspect | TalentMatch |
|---|---|
| Data model | Tables `resume_embeddings` and `job_embeddings`; PK = FK to `resumes` / `jobs` with `ON DELETE CASCADE` |
| Embeddings | `vector(384)`, unit length enforced by `CHECK (abs(vector_norm(embedding) - 1) < 0.001)` |
| Metadata | `model_name`, `chunk_count`, `source_hash` (SHA-256 of the embedded text, detects stale vectors), `created_at` |
| Index | HNSW with `vector_cosine_ops` on both tables |
| Retrieval strategy | `rank_candidates_for_job()` orders primary resumes of active users by `embedding <=> job_vector`; `compute_match_score()` stores `1 - distance` on each application |

Evidence: `docs/vector-design.md`.

## §5 SQL Implementation

> *Create and execute appropriate DDL statements… CREATE, ALTER, DROP, primary and foreign keys, constraints, indexes, views.*

| Statement | Where |
|---|---|
| CREATE TABLE / INDEX / VIEW / FUNCTION / TRIGGER / EXTENSION | `db/migrations/001`–`024` (24 numbered migrations, applied by `npm run db:migrate`) |
| ALTER TABLE (add column, add constraint, change type, drop/re-add constraint) | `db/migrations/009_alter_tables.sql`, `018_interview_offer_rules.sql` |
| DROP (view, function, table … CASCADE, schema) | `db/reset.sql` |
| Primary and foreign keys, constraints | `002`–`007` |
| Indexes (46: B-tree, 3 partial, 2 HNSW) | `003`, `005`, `007`, `008_indexes.sql` |
| Views (3) | `013_views.sql` |

## §6 Database Operations

> *Meaningful DML: INSERT, UPDATE, DELETE, SELECT… JOIN, GROUP BY, HAVING, ORDER BY, aggregate functions, subqueries.*

| Operation | Example in the application |
|---|---|
| INSERT | Register, upload resume, apply (`src/lib/applications.js`), schedule interview, make offer, seed data |
| UPDATE | Application status (`update_application_status()`), profile edits, mark notifications read |
| DELETE | Delete resume, skill, job, company (refused while in use) |
| SELECT | Every page and report |

`db/queries/important_queries.sql` contains **41 commented queries** covering JOIN, GROUP BY, HAVING, ORDER BY, aggregates, scalar and correlated subqueries, `EXCEPT`, CTEs and window functions (e.g. Q3 HAVING, Q8 correlated subqueries, Q9 scalar subquery, Q11 `LAG()`, Q24 `EXCEPT`). The file runs end-to-end with `ON_ERROR_STOP` and exits 0.

## §7 Advanced Database Features

> *At least four advanced database concepts for SQL and one NoSQL/Vector.*

| Concept | Implementation |
|---|---|
| **Transactions** | 8 multi-statement transactions: register, apply, schedule interview, make offer, accept/decline/withdraw offer, upload resume, create recruiter, job create/edit/delete. Demo: `db/demos/transaction_demo.sql`; atomicity proof Q28 |
| **Triggers** | 19 triggers (12 trigger functions): applicant count, status guard, status history, deferred stage-records check, offer/interview guards, withdraw offer on reject |
| **Stored functions** | 6: `update_application_status`, `generate_hiring_pipeline_report`, `rank_candidates_for_job`, `compute_match_score`, `is_valid_status_transition`, `local_today` |
| **Views** | 3: `recruiter_pipeline_view`, `candidate_application_view`, `company_hiring_summary` |
| **Indexing** | 46 indexes including partial and HNSW |
| **Vector similarity search** | pgvector cosine distance (`<=>`) with HNSW |

Evidence: `docs/advanced-features.md`, `db/migrations/010`–`023`.

## §8 Vector Database / Semantic Search

> *Explain: what data is converted into embeddings; which embedding approach/model is used; how vectors are stored; similarity metric used; how relevant results are retrieved.*

| Question | Answer |
|---|---|
| What is embedded | Each resume's extracted text (PDF/TXT); each job's `title + description + required skills` |
| Model | `sentence-transformers/all-MiniLM-L6-v2`, 384 dimensions, run locally in Node.js with `@huggingface/transformers` (no external API) |
| Chunking | ≤ 254 tokens per chunk, 32-token overlap; chunk vectors mean-pooled (token-weighted) and L2-normalised |
| Storage | `vector(384)` in `resume_embeddings` / `job_embeddings`, HNSW index |
| Metric | Cosine similarity = `1 - (a <=> b)` |
| Retrieval | `rank_candidates_for_job(job, limit, applicants_only)` (migration 015) |

Real result (Machine Learning Engineer job): Aditi Sharma 0.7819 (3/3 skills), Rohan Verma 0.6658 (1/3 skills), Divya Krishnan 0.5032 … Sneha Kulkarni 0.2438 (frontend profile, last). Evidence: `docs/vector-design.md`, `docs/test-cases.md` rows 5-19, 5-20.

## §9 Web Application Interface

> *Functional web-based interface using Next.js… forms, tables, search, filtering, dashboards.*

Next.js 16 (App Router) with role-based portals:

- **Candidate:** profile and skills forms, resume upload, job search with filters, skill-gap view, apply, application history, interviews, offers.
- **Recruiter:** job form, ranked applicants table, semantic search over all candidates, status changes, interview and offer forms.
- **Admin:** analytics dashboard, company and recruiter management.
- Notifications inbox for every role.

Evidence: `src/app/candidate`, `src/app/recruiter`, `src/app/admin`; 34 screenshots in `docs/screenshots/final/`.

## §10 Database–Application Integration

> *Communicate through an appropriate backend/API layer… credentials not hard-coded… environment variables.*

- Backend: Next.js Route Handlers under `src/app/api` (36 route files) → business logic in `src/lib` → raw parameterised SQL through one `pg` connection pool (`src/lib/db.js`). No ORM.
- Configuration only from environment variables (`DATABASE_URL`, `AUTH_JWT_SECRET`) in `.env.local`, which is git-ignored; `.env.example` holds names and placeholders only.

## §11 Authentication and Authorization

> *User authentication… role-based access (minimum 2 roles).*

- **Three roles:** admin, recruiter, candidate.
- Login issues a signed JWT in an httpOnly cookie; every request re-reads the user from the database (deactivated users rejected immediately).
- Every protected route is wrapped in `withAuth({ roles })` and checks the role on the server (401 / 403). Ownership is enforced inside SQL (another user's record → 404; another company's record → 403).

Evidence: `src/lib/auth/` (`password.js`, `jwt.js`, `session.js`, `guards.js`), `docs/authentication.md`.

## §12 Data Validation and Integrity

> *Input validation must be implemented at the database level… demonstrate how data consistency and integrity are maintained.*

- **Database level:** 57 CHECK constraints (e.g. status values, `salary_max >= salary_min`, rating 1–5, bcrypt-format password hash), 22 FKs, 8 UNIQUE constraints (e.g. one application per job per candidate, one offer per application), NOT NULL and DEFAULT.
- **Triggers** enforce cross-row rules: valid status transitions only, interviewed/offered must have supporting records (checked at COMMIT), no offer while an interview is scheduled, accepted offers final.
- **Transactions** keep multi-step changes atomic.
- **Application level** in addition: `zod` schemas on every input.

Evidence: `db/tests/stage1_constraint_tests.sql` (8/8 invalid writes rejected), `db/tests/stage2_advanced_tests.sql` (27 PASS).

## §13 Security

> *Basic database and web security practices… passwords and credentials not stored in plain text.*

- Passwords stored only as bcrypt hashes; a CHECK constraint rejects anything that is not a bcrypt hash.
- No credentials in code; secrets only in `.env.local` (git-ignored).
- Parameterised SQL only (SQL injection prevention).
- CSRF same-origin check, security headers, login rate limiting (5 failures per 15 minutes → 429), upload validation (type, size, file signature).

Evidence: `docs/security-review.md`.

## §14 Project Documentation

> *Problem statement, objectives, scope, functional requirements, ER diagram, relational schema, database choice and justification, data dictionary, SQL/NoSQL/vector implementation, important queries, system architecture, application screenshots, testing results, conclusion and future enhancements.*

All 14 items are sections 1–14 of `docs/project-report.md`, in the handout's order, with supporting documents:

| Item | Document |
|---|---|
| Problem statement, objectives, scope, functional requirements | `docs/project-report.md` §1–§4 |
| ER diagram | `docs/er-diagram.png`, `docs/er-diagram.md` |
| Relational schema | `docs/relational-schema.md` |
| Database choice and justification | `docs/project-report.md` §7, `docs/vector-design.md` |
| Data dictionary | `docs/data-dictionary.md` |
| SQL / vector implementation | `docs/advanced-features.md`, `docs/vector-design.md` |
| Important queries | `db/queries/important_queries.sql` |
| System architecture | `docs/project-report.md` §11 |
| Application screenshots | `docs/screenshots/final/` |
| Testing results | `docs/test-cases.md` |
| Conclusion and future enhancements | `docs/project-report.md` §14 |

## §15 Git/GitHub

> *Source code on Git/GitHub; commits demonstrate individual contributions; README with setup and execution instructions.*

- Repository: https://github.com/rohithkarning-debug/TalentMatch
- Work done on feature branches and merged into `main` through pull requests.
- `README.md` covers prerequisites, setup from a clean machine, environment variables, migrate / seed / embed, run, demo accounts and tests.
- Contribution record: `docs/project-report.md` §15.

## §16 Evaluation / Demonstration

> *Problem statement and motivation; ER diagram and database design; relational schema; database implementation; important queries/operations; Next.js interface; database integration; advanced database features; test cases; individual contribution.*

| Demonstration item | What to show |
|---|---|
| Problem statement and motivation | `docs/project-report.md` §1 |
| ER diagram and database design | `docs/er-diagram.png` |
| Relational schema | `docs/relational-schema.md` |
| Database implementation | `db/migrations/` |
| Important queries | `db/queries/important_queries.sql` |
| Next.js interface and integration | Live app (`npm run dev`) |
| Advanced database features | Invalid status change refused; company delete refused; ranked applicants; `docs/advanced-features.md` |
| Test cases | `docs/test-cases.md`; `npm run test:unit` (85 pass), `npm run test:integration` (147 pass) |
| Individual contribution | §2 above |

A step-by-step demo order is in `docs/viva-demo-script.md`.

## §17 Originality

> *Original design and implementation… not copied… teams in similar domains must have substantially different problem statements, features, database designs and implementations.*

The problem statement comes from the team's own synopsis. Distinguishing features of the design:

- semantic ranking and relational filtering in one SQL function, with the cosine score stored on each application and recomputable in SQL;
- skill-gap analysis with `EXCEPT`;
- the hiring workflow enforced by the database (status state machine, deferred constraint trigger, cross-table offer/interview rules);
- role-safe specialisation with a composite FK `(user_id, role)`.

## §18 Level 3 Expectation

> *Go beyond CRUD… clear connection between database concepts, design, implementation and a functional web application… justify SQL, NoSQL and/or vector choice by the nature of the data.*

| Data | Nature | Stored as | Reason |
|---|---|---|---|
| Users, companies, jobs, applications, interviews, offers, skills, notifications | Structured, related, must stay consistent | Relational tables | Keys, constraints, triggers and ACID transactions guarantee integrity; joins and aggregates power the reports |
| Resume and job description text | Unstructured; meaning matters more than exact words | `vector(384)` with pgvector | Cosine similarity ranks by meaning, which `LIKE` or keyword search cannot do |

Keeping vectors in the same PostgreSQL database means each vector belongs to a resume or job row through a real foreign key, one query can combine vector ranking with relational filters, and vectors share the same transactions and backups. Full justification: `docs/project-report.md` §7.
