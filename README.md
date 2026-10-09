# TalentMatch

AI-Assisted Resume-to-Job Matching and Recruitment Management System. This is a DBMS Level 3 mini-project (PES University, CSE, Section D).

**Team:** Rohith Karning (PES1UG24AM229) · Saanvi Maharana (PES1UG24AM237)

**Stack:** Next.js (App Router, JavaScript) · Tailwind CSS · PostgreSQL 17 + pgvector (Docker) · raw SQL via `pg`

> Status: Stage 3 (authentication + role-based access control) is done. Role dashboards and job/application features come next.

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

# 5. Start the app
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
npm run test:unit          # auth unit tests (no server/DB needed)
npm run build              # integration tests use the production build
npm run test:integration   # starts the app on port 3100 and tests the real API + DB
```

## Database scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies new files in `db/migrations/` in order. Already-applied files are skipped (tracked in `tm_meta.schema_migrations`). |
| `npm run db:seed` | Loads fictional demo data from `db/seed/seed.sql`. Safe to run more than once. |
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
- [Authentication and RBAC](docs/authentication.md)
- [Test cases and results](docs/test-cases.md)

## Notes

- The database listens on **localhost:5433** (not 5432), so it does not clash with a natively installed PostgreSQL. You can change this with `POSTGRES_PORT`.
- `db/init/001_enable_pgvector.sql` runs only when the Docker volume is first created. Migration `001` also enables `vector`, so migrations work on any database.
- Stop the DB with `docker compose --env-file .env.local stop`. Your data stays in the `talentmatch_pgdata` volume.
- Never commit `.env.local`. Only `.env.example` is tracked.
