# TalentMatch

AI-Assisted Resume-to-Job Matching and Recruitment Management System. This is a DBMS Level 3 mini-project.

**Stack:** Next.js (App Router, JavaScript) · Tailwind CSS · PostgreSQL 17 + pgvector (Docker) · raw SQL via `pg`

> Status: Stage 0 (project setup) is done. Application features have not been built yet.

## Prerequisites

- Node.js 20+ (developed on 22)
- Docker Desktop (Windows: WSL 2 backend)

## Setup (Windows PowerShell)

```powershell
# 1. Install dependencies
npm install

# 2. Create your local env file, then edit it and set a strong POSTGRES_PASSWORD
#    (update the password inside DATABASE_URL to match)
Copy-Item .env.example .env.local

# 3. Start PostgreSQL + pgvector (Docker Desktop must be running)
docker compose --env-file .env.local up -d --wait

# 4. Start the app
npm run dev
```

Open http://localhost:3000/api/health. You should see `"status":"ok"`, the PostgreSQL version, and the pgvector version.

## Notes

- The database listens on **localhost:5433** (not 5432), so it does not clash with a natively installed PostgreSQL. You can change this with `POSTGRES_PORT`.
- `db/init/001_enable_pgvector.sql` runs only when the Docker volume is first created. It enables the `vector` extension.
- Stop the DB with `docker compose --env-file .env.local stop`. Your data stays in the `talentmatch_pgdata` volume.
- Never commit `.env.local`. Only `.env.example` is tracked.
