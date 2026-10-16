# TalentMatch

AI-Assisted Resume-to-Job Matching and Recruitment Management System. This is a DBMS Level 3 mini-project (PES University, CSE, Section D).

**Team:** Rohith Karning (PES1UG24AM229) · Saanvi Maharana (PES1UG24AM237)

**Stack:** Next.js (App Router, JavaScript) · Tailwind CSS · PostgreSQL 17 + pgvector (Docker) · raw SQL via `pg`

> Status: Stage 7 is done. That covers interviews (schedule, reschedule, cancel, complete with a 1–5 rating; the first interview moves the application to `interviewed` in the same transaction), offers (a make-offer transaction, accept/decline before expiry, withdraw), and a notifications inbox for every role. Every rule is enforced in the database too (guard triggers and a deferred constraint trigger, migrations 018–019). Stages 1–6 cover the schema, triggers/functions/views, auth, the candidate module, pgvector matching, and the recruiter module with applications. The admin dashboard comes next.

## Prerequisites

- Node.js 22 (the db scripts use `node --env-file-if-exists`, which needs Node 22.9 or newer)
- Docker Desktop (Windows: WSL 2 backend)

## Setup (Windows PowerShell)

```powershell
# 1. Install dependencies
npm install

# 2. Create your local env file, then edit it:
#    - set a strong POSTGRES_PASSWORD (and the same password inside DATABASE_URL)
#    - set AUTH_JWT_SECRET to a random value (the placeholder is refused):
#        node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
Copy-Item .env.example .env.local

# 3. Start PostgreSQL + pgvector (Docker Desktop must be running)
docker compose --env-file .env.local up -d --wait

# 4. Create the tables and load demo data
npm run db:migrate
npm run db:seed

# 5. Create embeddings for the seeded resumes and jobs (first run downloads
#    the ~90 MB MiniLM model into .cache/transformers; needs internet once)
npm run db:embed

# 6. Start the app
npm run dev
```

Open http://localhost:3000/api/health. You should see `"status":"ok"`, the PostgreSQL version, and the pgvector version.
Then open http://localhost:3000 and sign in with a demo account below, or create a candidate account at `/register`.

## Authentication

Login uses an httpOnly session cookie that holds a signed JWT. Every API route checks the role on the server. Public registration creates **candidate** accounts only. Details: [docs/authentication.md](docs/authentication.md).

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/register` | Create a candidate account (201 / 400 / 409) |
| `POST /api/auth/login` | Log in (200 / 400 / 401 / 403) |
| `POST /api/auth/logout` | Clear the session cookie (200) |
| `GET /api/auth/me` | Current user `{id, email, fullName, role}` (200 / 401) |

## Tests

```powershell
npm run test:unit          # unit tests (no server/DB needed; embedding tests use the cached model)
npm run build              # integration tests use the production build
npm run test:integration   # starts the app (ports 3100-3104) and tests the real API + DB + model
```

## Semantic matching

Resumes and jobs are embedded locally with `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions) and stored in pgvector columns. `rank_candidates_for_job(job_id, limit, applicants_only)` ranks candidates by cosine similarity `1 - (resume <=> job)`. Details: [docs/vector-design.md](docs/vector-design.md).

| Endpoint | Purpose |
|---|---|
| `GET /api/recruiter/jobs/:jobId/matches?applicantsOnly=true\|false&limit=N` | Ranked candidates for a job of the recruiter's own company (200 / 400 / 401 / 403 / 404) |

## Recruiter module and applications (Stage 6)

Pages: recruiter `/recruiter` (My Jobs), `/recruiter/jobs/new`, `/recruiter/jobs/:id` (tabs "Ranked applicants" and "Search all candidates"), `/recruiter/jobs/:id/edit`. Candidate: `/candidate/jobs/:id` (skill gap and Apply), `/candidate/applications`.

| Endpoint | Purpose |
|---|---|
| `GET / POST /api/recruiter/jobs` | List / create jobs of the recruiter's company (job is embedded after COMMIT) |
| `GET / PATCH / DELETE /api/recruiter/jobs/:jobId` | View, edit (fields, status draft/open/closed, skills), delete; 403 for other companies, 409 if the job has applications |
| `GET /api/recruiter/jobs/:jobId/applications` | Applicants ranked by `match_score`, with matched/required skills and history |
| `PATCH /api/recruiter/applications/:applicationId` | Change status via `update_application_status()`; invalid transitions → 409 with the database's message |
| `GET / POST /api/candidate/applications` | My applications with history / apply (one transaction; 409 duplicate or closed job) |
| `GET /api/candidate/jobs/:jobId` | Job details, skill gap (`EXCEPT`), and my application |
| `GET /api/skills` | Skill catalogue (any signed-in user) |

`applications.match_score` = `compute_match_score(resume, job)` = `1 - (resume <=> job)` for the resume chosen when applying, or NULL if either side is not embedded yet. `npm run db:embed` fills in such NULL scores later. Details: [advanced-features.md §7–8](docs/advanced-features.md).

## Interviews, offers and notifications (Stage 7)

Pages: recruiter `/recruiter/interviews`, `/recruiter/offers` ("Schedule interview" and "Make offer" are on each applicant in `/recruiter/jobs/:id`). Candidate: `/candidate/interviews`, `/candidate/offers`. Every role: `/notifications`.

| Endpoint | Purpose |
|---|---|
| `POST /api/recruiter/applications/:applicationId/interviews` | Schedule the next round (future time; link or location). The first one moves the application `shortlisted → interviewed` in the same transaction and notifies the candidate |
| `GET /api/recruiter/interviews?scope=upcoming\|past\|all` | Interviews for the recruiter's company |
| `PATCH /api/recruiter/interviews/:interviewId` | `{ action: "reschedule" \| "cancel" \| "complete" }`; only scheduled interviews change (409 otherwise); rating 1–5 |
| `POST /api/recruiter/applications/:applicationId/offer` | **Transaction:** status → `offered` (only from `interviewed`) + offer row + notification; 409 if an offer exists or the transition is invalid |
| `GET /api/recruiter/offers` · `POST /api/recruiter/offers/:offerId/withdraw` | Company offers / withdraw a pending offer (application → `rejected`) |
| `GET /api/candidate/interviews` · `GET /api/candidate/offers` | Own interviews (no internal rating/feedback) / own offers |
| `POST /api/candidate/offers/:offerId/respond` | `{ decision: "accept" \| "decline" }` before expiry; notifies the recruiters; someone else's offer → 404 |
| `GET /api/notifications` · `PATCH /api/notifications/:id` · `POST /api/notifications/read-all` | Own inbox with unread count / mark read (others' → 404) / mark all read |

Details and the transaction diagrams: [advanced-features.md §9–11](docs/advanced-features.md). Queries Q27–Q32 in `db/queries/important_queries.sql`.

## Database scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies new files in `db/migrations/` in order. Already-applied files are skipped (tracked in `tm_meta.schema_migrations`). |
| `npm run db:seed` | Loads fictional demo data from `db/seed/seed.sql`. Safe to run more than once. |
| `npm run db:embed` | Embeds every resume and job that has no embedding yet (or whose text or model changed), then fills in any NULL application match scores. Safe to run more than once. |
| `npm run db:reset` | **Destructive.** Drops all TalentMatch tables and data. It only works on the local Docker dev database and asks you to type the database name. Add `-- --yes` to skip the prompt. |

SQL scripts (PowerShell, from the project root):

```powershell
Get-Content db/tests/stage1_constraint_tests.sql  | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
Get-Content db/tests/stage2_advanced_tests.sql    | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
Get-Content db/queries/important_queries.sql      | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
Get-Content db/demos/transaction_demo.sql         | docker exec -i talentmatch-db psql -U talentmatch -d talentmatch
```

## Demo accounts (local development only)

All demo accounts use the password **`TalentMatch@2026`**. Only its bcrypt hash is stored in the database. All people and companies are fictional.

| Role | Email | Notes |
|---|---|---|
| Admin | admin@talentmatch.example | |
| Recruiter | meera.iyer@nimbusanalytics.example | Nimbus Analytics |
| Recruiter | arjun.rao@nimbusanalytics.example | Nimbus Analytics |
| Recruiter | kavya.menon@kestrellabs.example | Kestrel Software Labs |
| Recruiter | rahul.kamath@orbitline.example | Orbitline Cloud Systems |
| Candidate | aditi.sharma@mail.example | ML engineer |
| Candidate | rohan.verma@mail.example | Data scientist (has a pending offer) |
| Candidate | sneha.kulkarni@mail.example | Frontend |
| Candidate | vikram.chauhan@mail.example | Frontend |
| Candidate | ananya.gupta@mail.example | Backend (Node.js) |
| Candidate | karthik.subramanian@mail.example | Backend (Java) |
| Candidate | ishita.banerjee@mail.example | Data analyst |
| Candidate | farhan.qureshi@mail.example | Data analyst |
| Candidate | neha.bhatt@mail.example | DevOps |
| Candidate | siddharth.pillai@mail.example | SRE / DevOps |
| Candidate | divya.krishnan@mail.example | Graduate ML / NLP |
| Candidate | aman.malhotra@mail.example | Full stack |

## Documentation

- [ER diagram](docs/er-diagram.md) (Mermaid)
- [Relational schema](docs/relational-schema.md), including why PostgreSQL + pgvector share one database
- [Data dictionary](docs/data-dictionary.md)
- [Advanced SQL features](docs/advanced-features.md): triggers, functions, views, queries, transactions
- [Vector design](docs/vector-design.md): embeddings, chunking, HNSW, cosine ranking
- [Authentication and RBAC](docs/authentication.md)
- [Test cases and results](docs/test-cases.md)

## Notes

- The database listens on **localhost:5433** (not 5432), so it does not clash with a natively installed PostgreSQL. You can change this with `POSTGRES_PORT`.
- `db/init/001_enable_pgvector.sql` runs only when the Docker volume is first created. Migration `001` also enables `vector`, so migrations work on any database.
- Stop the DB with `docker compose --env-file .env.local stop`. Your data stays in the `talentmatch_pgdata` volume.
- Never commit `.env.local`. Only `.env.example` is tracked.
