# CLAUDE.md — TalentMatch

**TalentMatch — AI-Assisted Resume-to-Job Matching and Recruitment Management System**
DBMS Experiential Learning, Level 3 mini-project (PES University, CSE, Section D).
Team (2 members): Rohith Karning (PES1UG24AM229) and [Teammate Name].
Dev OS: Windows 11 (PowerShell + Git Bash). Postgres runs in Docker.

Reference documents (source of truth for requirements):
- `docs/reference/TalentMatch_Synopsis.docx` — approved synopsis
- `docs/reference/DBMS Level 3 Project Requirements.pdf` — course requirements

---

## Working rules (follow strictly)

1. **Work in stages.** Do only the stage the user asks for, then STOP and wait.
2. **End-of-stage report** must contain: what was built, files created/modified, DBMS concepts demonstrated, exact commands to run and test, what remains incomplete.
3. **Never claim something works without actually running/testing it.** If a test could not be run, say so.
4. **No hardcoded secrets.** Real values live in `.env.local` (gitignored). `.env.example` holds variable names only. Never commit any `.env*` file except `.env.example`.
5. **Match scores must come from real cosine similarity** computed by pgvector. Never fake, random, or placeholder scores.
6. **Sample data must be realistic but fictional** — no real people's names, emails, phone numbers, or resumes.
7. **Don't delete or rewrite working code** without explaining why first.
8. **Explain important decisions in beginner-friendly language** (this is for a viva).
9. **Keep `docs/` updated** as we go: schema, data dictionary, vector design, test cases.
10. **Minimal dependencies.** Allowed: `next`, `react`, `react-dom`, `pg`, `bcryptjs`, `jose`, `zod`, `@huggingface/transformers`, one PDF text extractor, Tailwind (and its build tooling). **Ask before adding anything else.**

---

## Fixed tech decisions

| Area | Decision |
|---|---|
| Frontend | Next.js (App Router), **plain JavaScript (no TypeScript)**, Tailwind CSS |
| Backend | Next.js Route Handlers under `src/app/api` |
| Database | PostgreSQL + pgvector in the **same** database. Docker image `pgvector/pgvector` on Windows |
| DB access | **Raw SQL** via `pg` with a connection `Pool`. **No ORM** — SQL must be visible for the viva. Always parameterized queries (`$1, $2…`), never string-concatenated SQL |
| Auth | `bcryptjs` password hashing + JWT in an **httpOnly** cookie signed with `jose` |
| Roles | `admin`, `recruiter`, `candidate`. **Every route handler checks the role on the server** — middleware/UI checks are convenience only, never the sole guard |
| Validation | `zod` in the API **and** CHECK / NOT NULL / UNIQUE / FK constraints + triggers in the DB (the PDF requires DB-level validation) |
| Embeddings | Local model `sentence-transformers/all-MiniLM-L6-v2` (384 dims) via `@huggingface/transformers`. Chunk long resumes → embed each chunk → store the **L2-normalized mean vector** |
| Similarity | Cosine distance operator `<=>`; score = `1 - (a <=> b)`. **HNSW** index with `vector_cosine_ops` |

---

## Schema (agreed design)

- `users` — login identity, password hash, role
- `companies`
- `recruiters` — PK = FK → `users`; FK → `companies`
- `candidates` — PK = FK → `users`
- `skills`
- `candidate_skills` — M:N candidates ↔ skills
- `jobs` — FK → recruiter/company; status (open/closed), `applicant_count`
- `job_skills` — M:N jobs ↔ skills
- `resumes` — FK → candidates; file path + extracted text
- `applications` — **UNIQUE (job_id, candidate_id)**; `status` CHECK IN (`applied`, `shortlisted`, `interviewed`, `offered`, `rejected`); `match_score`
- `application_status_history` — audit trail of status changes
- `interviews` — FK → applications
- `offers` — **UNIQUE (application_id)**
- `notifications` — FK → users
- `resume_embeddings` — `vector(384)`, FK → resumes
- `job_embeddings` — `vector(384)`, FK → jobs

## Advanced features to implement

- **Transactions:** apply to job (application + status history + notification), make offer, registration (users + role table)
- **Triggers:** maintain `jobs.applicant_count`; audit status changes into `application_status_history`; guard against invalid status transitions
- **Functions:** `rank_candidates_for_job()`, `generate_hiring_pipeline_report()`, `update_application_status()`
- **Views:** `recruiter_pipeline_view`, `candidate_application_view`, `company_hiring_summary` (uses GROUP BY + HAVING)
- **Indexes:** B-tree on FK columns, partial index on open jobs, HNSW on embedding columns
- **Vector similarity search:** rank candidates for a job and jobs for a candidate

---

## Repository layout

```
db/migrations/                 numbered .sql files (001_..., 002_...)
db/seed/                       fictional sample data
db/queries/important_queries.sql
db/reset.sql
scripts/                       Node scripts (migrate, seed, embed, ...)
src/app/                       pages + src/app/api route handlers
src/lib/                       db pool, auth, validation, embeddings
src/components/                UI components
docs/                          project documentation (keep updated)
docs/reference/                original synopsis + requirements (do not edit)
uploads/                       uploaded resumes (gitignored)
```

---

## Mandatory requirements summary (from the DBMS Level 3 PDF)

- **Not simple CRUD** — must solve a real problem and go beyond CRUD (Level 3 expectation).
- **2-member team**; each member contributes to **both** DB and app work; **individual Git commits** must show this.
- **Databases:** SQL (PostgreSQL) mandatory + a second paradigm (we use **Option 2: pgvector**). The choice must be **justified by the nature of the data**, not just for show.
- **Design:** ER diagram → relational schema identifying entities, attributes, PKs, FKs, relationships, constraints. For the vector part, document the data model, indexes, embeddings, metadata, retrieval strategy.
- **DDL:** demonstrate CREATE, ALTER, DROP, PK/FK, constraints, indexes, views.
- **DML:** INSERT, UPDATE, DELETE, SELECT; queries using JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries.
- **Advanced features:** at least **4 SQL advanced concepts** (transactions, views, procedures/functions, triggers, indexing, full-text search…) **+ 1 vector** (similarity search).
- **Vector explanation:** what data is embedded, which model, how vectors are stored, similarity metric, how results are retrieved.
- **Next.js web UI** with forms, tables, search, filtering, dashboards.
- **DB access through a backend/API layer**; credentials via **environment variables**, never hardcoded.
- **Auth + role-based access**, minimum 2 roles (we have 3).
- **Validation at the database level**; demonstrate data consistency and integrity.
- **Security:** passwords and credentials never stored in plain text; basic web/DB security practices.
- **Documentation (soft copy):** problem statement, objectives, scope, functional requirements, ER diagram, relational schema, DB choice & justification, data dictionary, SQL/vector implementation, important queries, system architecture, screenshots, testing results, conclusion & future enhancements.
- **Git/GitHub** with a README containing setup and run instructions.
- **Demo covers:** problem & motivation, ER/design, schema, DB implementation, important queries, Next.js UI, integration, advanced features, test cases, individual contributions.
- **Originality:** no copying of existing projects/tutorials/repos.
