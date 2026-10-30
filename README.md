# TalentMatch

**AI-Assisted Resume-to-Job Matching and Recruitment Management System** — DBMS Experiential Learning, Level 3 mini-project (PES University, CSE, Section D).

**Team:** Rohith Karning (PES1UG24AM229) · Saanvi Maharana (PES1UG24AM237)

TalentMatch is a recruitment system for companies that receive many resumes per opening. It ranks candidates by the **meaning** of their resume, not only by keywords: resumes and job descriptions are turned into 384-number embeddings, stored in PostgreSQL with **pgvector**, and compared with cosine similarity. Around that sits a full hiring pipeline (apply → shortlist → interview → offer → accept/decline, or reject) whose rules are enforced **inside the database** with constraints, triggers, functions, views and transactions.

**Database option:** SQL + Vector Database (course requirements §3, Option 2): PostgreSQL for the relational data and pgvector as the vector store, in one database.

| Document | What it covers |
|---|---|
| [Project report](docs/project-report.md) ([PDF](docs/TalentMatch_Project_Report.pdf)) | All 14 documentation sections required by the course |
| [Course requirements, answered](docs/handout-requirements.md) | Every handout requirement (§1–§18) with where it is met in this repository |
| [Hiring statistics report](docs/company-statistics.md) | TalentMatch treated as a company: funnel, speed, salaries, skills, recommendations |

## Diagrams

**Use case diagram** — who uses the system and what they can do:

![TalentMatch use case diagram](docs/use-case-diagram.png)

**ER diagram (Chen notation)** — 16 tables, cardinalities, weak entities and the pgvector tables:

![TalentMatch ER diagram](docs/er-diagram-chen.png)

The column-level crow's-foot diagram is in [docs/er-diagram.md](docs/er-diagram.md) ([image](docs/er-diagram.png)).

## Features by role

**Candidate**
- Register, log in, edit profile and skills (proficiency 1–5).
- Upload resumes (PDF or TXT, at most 5 MB, at least 50 characters of text), choose a primary resume; each resume is embedded automatically.
- Search and filter open jobs (keyword, location, work mode, employment type, experience).
- See the skill gap for a job (have / below level / missing).
- Apply with a chosen resume and get a real cosine match score; track every application with its status history.
- See interviews; accept or decline offers before they expire; notifications inbox.

**Recruiter** (accounts are created by the admin; a recruiter works only on their own company's data)
- Create, edit, open/close and delete jobs with required skills.
- See applicants ranked by match score with matched/required skills, and search *all* candidates by semantic similarity.
- Move applications through the allowed stages (invalid moves are refused by the database with a readable message).
- Schedule, reschedule, cancel and complete interviews (rating and internal feedback); make and withdraw offers.

**Admin**
- Dashboard: platform totals, applications per stage, top demanded skills, average match score by outcome, per-company table (offer acceptance rate, interview rating), per-job funnel.
- Manage companies (deleting a company that still has recruiters or jobs is refused by the database) and recruiter accounts (create, edit, move, deactivate).

## Hiring statistics (demo data)

Computed from the seeded database; full report with charts in [docs/company-statistics.md](docs/company-statistics.md).

| Metric | Value |
|---|---|
| Companies · recruiters · candidates | 3 · 4 · 12 |
| Job postings · openings | 8 (6 open) · 14 |
| Applications | 18 |
| Hiring funnel | 18 applied → 9 shortlisted → 6 interviewed → 3 offered → 1 hired |
| Shortlist rate · offer rate | 50% · 17% |
| Offer acceptance (decided offers) | 50% (1 accepted, 1 declined, 1 pending) |
| Slowest stage | Shortlisted → interviewed, 14.1 days on average |
| Time to hire (completed hire) | 22.0 days |

![Hiring funnel](docs/statistics/01-funnel.png)

## Tech stack

| Area | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, plain JavaScript, Tailwind CSS 4 |
| Backend | Next.js Route Handlers (`src/app/api`) |
| Database | PostgreSQL 17 + pgvector 0.8 in one database (Docker image `pgvector/pgvector:pg17`) |
| DB access | Raw parameterized SQL with `pg` (connection pool), no ORM |
| Auth | `bcryptjs` password hashes, JWT (`jose`, HS256) in an httpOnly cookie |
| Validation | `zod` in the API; CHECK / NOT NULL / UNIQUE / FK constraints and triggers in the database |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions), run locally with `@huggingface/transformers` |
| PDF text | `pdfjs-dist` |
| Tests | Node's built-in `node:test` runner |

## Architecture

```
Browser (React pages)
   │  fetch JSON, httpOnly session cookie
   ▼
Next.js server ─ Route Handlers ─ withAuth (JWT + DB re-read + role check) ─ zod + same-origin check
   │                                   │
   │                                   ├── src/lib/*  raw SQL via pg Pool ($1, $2 … parameters only)
   │                                   └── embedding model (local, loaded once per process)
   ▼
PostgreSQL 17 + pgvector (Docker, localhost:5433)
   16 tables · 57 CHECK · 22 FK · 19 triggers · 6 functions · 3 views · HNSW indexes on vector(384)
```

The database is the final authority: even a direct `UPDATE` in psql cannot skip a pipeline stage, create a second offer, or store a plaintext password. Details: [project report §11](docs/project-report.md#11-system-architecture).

## Setup from a clean machine (Windows PowerShell)

**Prerequisites**
- Git
- Node.js **22.9 or newer** (the scripts use `node --env-file-if-exists`)
- Docker Desktop (Windows: WSL 2 backend), running
- Internet access once, for `npm install` and the first model download (~90 MB)

```powershell
# 1. Get the code and install dependencies
git clone https://github.com/rohithkarning-debug/TalentMatch.git
cd TalentMatch
npm install

# 2. Create your local env file from the template, then edit .env.local:
#    - set a strong POSTGRES_PASSWORD and put the same password inside DATABASE_URL
#    - set AUTH_JWT_SECRET to a random value (the placeholder is refused). Generate one with:
#        node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
Copy-Item .env.example .env.local
notepad .env.local

# 3. Start PostgreSQL + pgvector (port 5433 on localhost)
docker compose --env-file .env.local up -d --wait

# 4. Create the schema (migrations 001-024) and load the fictional demo data
npm run db:migrate
npm run db:seed

# 5. Embed the seeded resumes and jobs (first run downloads the model into .cache/transformers)
npm run db:embed

# 6a. Production build (what the integration tests use)
npm run build
npm start

# 6b. ...or development mode with reload on save
npm run dev
```

Check http://localhost:3000/api/health — it returns `"status":"ok"` with the PostgreSQL and pgvector versions. Then open http://localhost:3000 and sign in with a demo account below.

**Start over with a clean database** (destructive; refuses anything except the local Docker database):

```powershell
npm run db:reset -- --yes
npm run db:migrate
npm run db:seed
npm run db:embed
```

Stop the database with `docker compose --env-file .env.local stop`; the data stays in the `talentmatch_pgdata` volume.

## Demo accounts

All demo accounts use the password **`TalentMatch@2026`** (only its bcrypt hash is in the database). Every person and company is fictional.

| Role | Email | Notes |
|---|---|---|
| Admin | admin@talentmatch.example | |
| Recruiter | meera.iyer@nimbusanalytics.example | Nimbus Analytics — ML Engineer, NLP Intern |
| Recruiter | arjun.rao@nimbusanalytics.example | Nimbus Analytics — Data Analyst |
| Recruiter | kavya.menon@kestrellabs.example | Kestrel Software Labs — Frontend, Backend, Full Stack (draft) |
| Recruiter | rahul.kamath@orbitline.example | Orbitline Cloud Systems — SRE (closed), DevOps |
| Candidate | aditi.sharma@mail.example | ML engineer; interviewed for ML Engineer, round 2 scheduled |
| Candidate | rohan.verma@mail.example | Data scientist; **pending offer** for ML Engineer |
| Candidate | sneha.kulkarni@mail.example | Frontend; interviewed, round 2 scheduled |
| Candidate | vikram.chauhan@mail.example | Frontend |
| Candidate | ananya.gupta@mail.example | Backend (Node.js) |
| Candidate | karthik.subramanian@mail.example | Backend (Java) |
| Candidate | ishita.banerjee@mail.example | Data analyst; shortlisted |
| Candidate | farhan.qureshi@mail.example | Data analyst |
| Candidate | neha.bhatt@mail.example | DevOps; **accepted** the SRE offer |
| Candidate | siddharth.pillai@mail.example | SRE / DevOps |
| Candidate | divya.krishnan@mail.example | Graduate ML / NLP; shortlisted |
| Candidate | aman.malhotra@mail.example | Full stack; **declined** the Backend offer |

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Run the production build on port 3000 |
| `npm run db:migrate` | Apply new files in `db/migrations/` in order, each in its own transaction. Applied files are recorded with a SHA-256 checksum in `tm_meta.schema_migrations`; an edited applied migration is refused |
| `npm run db:seed` | Load the fictional demo data (`db/seed/seed.sql`, one transaction, safe to re-run) |
| `npm run db:embed` | Embed every resume and job that has no embedding or a stale one, then fill any NULL match scores (safe to re-run) |
| `npm run db:reset` | **Destructive.** Drop all TalentMatch objects; only works on the local Docker database and asks for confirmation (`-- --yes` skips it) |
| `npm run test:unit` | Unit tests (no server or database needed) |
| `npm run test:integration` | Integration tests: starts the production build on ports 3100–3105 and tests the real API, database and model |
| `npm test` | Both test suites |

## Testing

Integration tests need the database migrated, seeded and embedded, and a fresh production build. They create their own `@test.example` accounts and delete them afterwards.

```powershell
npm run test:unit
npm run build
npm run test:integration
```

SQL test scripts and demonstrations (run from the project root):

```powershell
Get-Content db/tests/stage1_constraint_tests.sql | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
Get-Content db/tests/stage2_advanced_tests.sql   | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
Get-Content db/queries/important_queries.sql     | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
Get-Content db/demos/transaction_demo.sql        | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
```

Final results (16 Oct 2026, clean rebuild): unit **85/85**, integration **147/147**, constraint tests 8/8 rejected, advanced-feature tests 27 PASS, transaction demo unchanged before/after. `important_queries.sql` runs Q1–Q41 with `ON_ERROR_STOP` and exits 0. Every case: [docs/test-cases.md](docs/test-cases.md).

## Folder structure

```
db/
  init/                 runs once when the Docker volume is created (enables pgvector)
  migrations/           001-024 numbered SQL migrations (never edited once applied)
  seed/seed.sql         fictional demo data
  queries/              important_queries.sql (41 commented queries)
  demos/                transaction_demo.sql (COMMIT, ROLLBACK, SAVEPOINT)
  tests/                SQL constraint and advanced-feature tests
  reset.sql             drops every TalentMatch object
scripts/                migrate, seed, embed, reset (+ lib/ safety checks)
src/
  app/                  pages per role (candidate, recruiter, admin, notifications, login, register)
  app/api/              route handlers (36 files)
  components/           UI components
  lib/                  db pool, auth, validation, embeddings, vector store, business logic
tests/
  unit/                 node:test unit tests
  integration/          node:test API + database tests
  fixtures/             sample resume files
docs/
  project-report.md     the 14-section project report (+ TalentMatch_Project_Report.pdf)
  handout-requirements.md   course requirements §1–§18, answered with evidence
  company-statistics.md     hiring statistics report (charts in statistics/)
  use-case-diagram.png      UML use case diagram (+ .svg)
  er-diagram-chen.png       ER diagram in Chen notation (+ .svg)
  er-diagram.md / .png      column-level ER diagram (crow's foot)
  screenshots/final/        34 application screenshots
  reference/                course requirements handout and project synopsis
  …                         design docs, test cases, security review, viva demo script
docker-compose.yml      PostgreSQL 17 + pgvector container
.env.example            variable names and placeholders only
```

## Security notes

- **Passwords:** bcrypt (cost 12). A CHECK constraint rejects anything that is not a bcrypt hash, so a plaintext password cannot be stored even by mistake.
- **Sessions:** JWT signed with HS256 in the `tm_session` cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8 hours. On every request the user is re-read from the database, so a disabled account or changed role takes effect immediately.
- **Authorization:** every route handler checks the role on the server (`withAuth`). Ownership is part of the SQL (`WHERE … AND candidate_id = <session user>`); another user's record answers 404, another company's record 403. Public registration can only create candidates.
- **SQL injection:** every value is a `$n` parameter; no user input is ever concatenated into SQL.
- **CSRF:** `SameSite=Lax` cookie, Origin / `Sec-Fetch-Site` check on every state-changing route, JSON-only bodies.
- **Login rate limit:** 5 failed attempts per email + IP per 15 minutes → 429.
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy; no `X-Powered-By`.
- **Secrets:** only in `.env.local`, which is gitignored; `.env.example` holds placeholders. `docker-compose.yml` reads the password from the env file.
- **Uploads:** PDF/TXT only, extension + MIME + `%PDF-` magic bytes checked, 5 MB limit, stored under random names in `uploads/` (gitignored).

Known limitations (in-memory rate limiter, stateless JWT, no `script-src` CSP): [docs/security-review.md](docs/security-review.md#5-known-limitations-not-fixed).

## Documentation

- [Project report](docs/project-report.md) ([PDF](docs/TalentMatch_Project_Report.pdf)) — all 14 required sections, team contribution
- [Course requirements, answered](docs/handout-requirements.md) — §1–§18 of the handout with evidence
- [Hiring statistics report](docs/company-statistics.md) — TalentMatch as a company, with charts
- [Use case diagram](docs/use-case-diagram.png) · [ER diagram, Chen notation](docs/er-diagram-chen.png)
- [Viva demo script](docs/viva-demo-script.md) — 10-minute demo, live psql queries, 30 likely questions
- [ER diagram, column level](docs/er-diagram.md) ([image](docs/er-diagram.png))
- [Relational schema](docs/relational-schema.md) — tables, FK delete rules, indexes, normalisation
- [Data dictionary](docs/data-dictionary.md)
- [Advanced SQL features](docs/advanced-features.md) — triggers, functions, views, transactions
- [Vector design](docs/vector-design.md) — embeddings, chunking, HNSW, cosine ranking
- [Authentication and RBAC](docs/authentication.md)
- [Security review](docs/security-review.md)
- [Test cases and results](docs/test-cases.md)
- [Screenshots](docs/screenshots/final/)
- [Course requirements handout](docs/reference/)

## Notes

- The database listens on **localhost:5433** so it does not clash with a native PostgreSQL on 5432 (change it with `POSTGRES_PORT`).
- `db/init/001_enable_pgvector.sql` runs only when the Docker volume is first created; migration 001 also enables `vector`, so migrations work on any database.
- Never commit `.env.local`. Only `.env.example` is tracked.