# TalentMatch — Security Review (Stage 9)

Reviewed on 2026-10-16: every route handler in `src/app/api` (36 files, 49 route/method pairs after the demo routes were removed), the auth helpers, `next.config.mjs` and the full git history (96 commits on all branches, re-checked after the last change). Every finding below was checked against the running production build (`next start`), not only by reading code.

## 1. How every route is protected

All protected handlers are wrapped in `withAuth({ roles })` (`src/lib/auth/guards.js`). It loads the user from the JWT **and re-reads `users` from PostgreSQL** (401 if missing, inactive, or the role changed), then checks the role (403) before the handler runs. Ownership is always decided from rows loaded from the database, never from ids in the body.

Legend: **Auth** = session required · **Role** = roles allowed · **Owner** = ownership / company check · **Input** = zod schema (B = body, Q = query string, P = route param) · **CSRF** = `assertSameOrigin()`.

### Public and shared routes

| Route | Method | Auth | Role | Owner | Input | CSRF | Notes |
|---|---|---|---|---|---|---|---|
| `/api/health` | GET | – | – | – | none | n/a | Reports only version numbers (fixed in Stage 9, §3) |
| `/api/auth/register` | POST | – | – | – | B `registerSchema` (strict) | ✓ | Role is hard-coded to `candidate`; a `role` field is a 400 |
| `/api/auth/login` | POST | – | – | – | B `loginSchema` | ✓ | Same 401 `INVALID_CREDENTIALS` for unknown email and wrong password; bcrypt always runs (dummy hash) so timing matches. **Rate limited:** 5 attempts per email + IP per 15 min → 429 `TOO_MANY_ATTEMPTS` |
| `/api/auth/logout` | POST | – | – | – | none | ✓ | Clears the cookie with the same flags |
| `/api/auth/me` | GET | ✓ | any | own session | none | n/a | Only `toSafeUser()` fields |
| `/api/skills` | GET | ✓ | any | – (public catalogue) | none | n/a | Read-only |
| `/api/notifications` | GET | ✓ | any | `WHERE user_id = session` | Q `notificationListQuerySchema` (strict) | n/a | `?userId=` is a 400 |
| `/api/notifications/:id` | PATCH | ✓ | any | in the UPDATE: `AND user_id = $2` → 404 | P + B `notificationUpdateSchema` | ✓ | |
| `/api/notifications/read-all` | POST | ✓ | any | `WHERE user_id = session` | none | ✓ | |

### Admin routes (admin only; admin may manage every company and recruiter)

| Route | Method | Auth | Role | Owner | Input | CSRF |
|---|---|---|---|---|---|---|
| `/api/admin/dashboard` | GET | ✓ | admin | n/a | none | n/a |
| `/api/admin/companies` | GET / POST | ✓ | admin | n/a | B `companyCreateSchema` (strict) | POST ✓ |
| `/api/admin/companies/:companyId` | GET / PATCH / DELETE | ✓ | admin | n/a | P + B `companyUpdateSchema` (strict, ≥ 1 field) | PATCH, DELETE ✓ |
| `/api/admin/recruiters` | GET / POST | ✓ | admin | n/a | B `recruiterCreateSchema` (strict; no `role`) | POST ✓ |
| `/api/admin/recruiters/:recruiterId` | GET / PATCH | ✓ | admin | only `role = 'recruiter'` rows (admin account → 404) | P + B `recruiterUpdateSchema` (strict) | PATCH ✓ |

### Candidate routes (candidate only; every query is filtered by the session user id)

| Route | Method | Auth | Role | Owner | Input | CSRF |
|---|---|---|---|---|---|---|
| `/api/candidate/profile` | GET / PATCH | ✓ | candidate | `WHERE user_id = session` | B `candidateProfileSchema` | PATCH ✓ |
| `/api/candidate/skills` | GET / POST | ✓ | candidate | session id | B `candidateSkillSchema`; skill must exist | POST ✓ |
| `/api/candidate/skills/:skillId` | DELETE | ✓ | candidate | `WHERE candidate_id = session` → 404 | P | ✓ |
| `/api/candidate/resumes` | GET / POST | ✓ | candidate | session id | multipart: ≤ 5 MB, `.pdf` / `.txt` + MIME, `%PDF-` magic bytes, ≥ 50 characters of text; stored under a random UUID name | POST ✓ |
| `/api/candidate/resumes/:resumeId` | PATCH / DELETE | ✓ | candidate | `WHERE candidate_id = session` → 404 | P + B `resumeUpdateSchema` | ✓ |
| `/api/candidate/jobs` | GET | ✓ | candidate | open jobs only | Q `jobSearchSchema` (strict; LIKE wildcards escaped) | n/a |
| `/api/candidate/jobs/:jobId` | GET | ✓ | candidate | open, or closed and applied; drafts → 404 | P | n/a |
| `/api/candidate/applications` | GET / POST | ✓ | candidate | session id; resume must belong to the candidate (checked in the transaction) | B `applicationCreateSchema` | POST ✓ |
| `/api/candidate/interviews` | GET | ✓ | candidate | `WHERE a.candidate_id = session`; rating and feedback never selected | none | n/a |
| `/api/candidate/offers` | GET | ✓ | candidate | `WHERE a.candidate_id = session` | none | n/a |
| `/api/candidate/offers/:offerId/respond` | POST | ✓ | candidate | lookup `AND a.candidate_id = session` → 404 | P + B `offerResponseSchema` | ✓ |

### Recruiter routes (recruiter only; a recruiter manages every job of THEIR company)

| Route | Method | Auth | Role | Owner (company check, loaded from the DB) | Input | CSRF |
|---|---|---|---|---|---|---|
| `/api/recruiter/jobs` | GET / POST | ✓ | recruiter | company from `recruiters` row; body cannot set `companyId`/`recruiterId` | B `jobCreateSchema` (strict) | POST ✓ |
| `/api/recruiter/jobs/:jobId` | GET / PATCH / DELETE | ✓ | recruiter | `assertJobInRecruiterCompany` (PATCH/DELETE also lock the row) → 403 | P + B `jobUpdateSchema` (strict) | PATCH, DELETE ✓ |
| `/api/recruiter/jobs/:jobId/applications` | GET | ✓ | recruiter | `assertJobInRecruiterCompany` | P | n/a |
| `/api/recruiter/jobs/:jobId/matches` | GET | ✓ | recruiter | job company = recruiter company | P + Q `jobMatchesQuerySchema` (strict) | n/a |
| `/api/recruiter/applications/:applicationId` | PATCH | ✓ | recruiter | API check **and** again inside `update_application_status()` (42501 → 403) | P + B `applicationStatusSchema` | ✓ |
| `/api/recruiter/applications/:applicationId/interviews` | POST | ✓ | recruiter | `assertApplicationInRecruiterCompany` (row locked) | P + B `interviewScheduleSchema` | ✓ |
| `/api/recruiter/applications/:applicationId/offer` | POST | ✓ | recruiter | `assertApplicationInRecruiterCompany` (row locked) | P + B `offerCreateSchema` | ✓ |
| `/api/recruiter/interviews` | GET | ✓ | recruiter | `WHERE j.company_id = recruiter's company` | Q `interviewListQuerySchema` (strict) | n/a |
| `/api/recruiter/interviews/:interviewId` | PATCH | ✓ | recruiter | interview's company = recruiter's company (row locked) | P + B `interviewUpdateSchema` | ✓ |
| `/api/recruiter/offers` | GET | ✓ | recruiter | `WHERE j.company_id = recruiter's company` | none | n/a |
| `/api/recruiter/offers/:offerId/withdraw` | POST | ✓ | recruiter | offer's company = recruiter's company (row locked) | P | ✓ |

**Route params:** every `:id` goes through `idParamSchema` (positive safe integer). Admin routes answer a malformed id with 400; candidate and recruiter routes answer 404 ("no such record"), and the tests check both behaviours. GET routes with no query schema do not read the query string at all.

## 2. Cross-cutting checks

| Check | How it was verified | Result |
|---|---|---|
| Parameterized SQL only | `grep` for every `query(` with `${…}`: the only interpolations are fixed column lists (`OFFER_COLUMNS`, `INTERVIEW_COLUMNS`, `COMPANY_COLUMNS`), `FOR UPDATE` clauses, and `SET`/`WHERE` lists built from fixed column maps (`JOB_COLUMNS`, `COLUMN_FOR`, the profile mapping). Every value is a `$n` parameter | Pass; candidate test J3 sends `' OR 1=1 --` and `%` as search text and gets 0 rows |
| One error shape, no leaks | `handleApiError()`: `ApiError` → its status; `ZodError` → 400 with field errors; `23505` → 409; `23503`/`23514`/`22P02` → 400 with the constraint name only; trigger errors → 409 with our own message; anything else → logged on the server, client gets `500 INTERNAL_ERROR "Something went wrong"` | Pass; malformed JSON → `400 "Request body is not valid JSON"`; test S1 scans every response body and header for the JWT secret, DB password and bcrypt hashes |
| Login rate limit | `src/lib/auth/login-rate-limit.js`: the attempt is counted **before** bcrypt (synchronously, so parallel requests are counted one by one), a successful login resets it; 429 + `Retry-After` | Pass: 5 wrong → 401 ×5, 6th → 429 even with the right password; 50 parallel → exactly 5 × 401 and 45 × 429; unknown emails limited the same way; invalid input not counted |
| Login does not reveal accounts | Live: `nobody@x.example` and `admin@…` with a wrong password both return the identical body `{"error":{"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}}` | Pass (test L3). `ACCOUNT_DISABLED` is only shown after the correct password |
| Cookie flags | Live `Set-Cookie: tm_session=…; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=lax` under `next start` | Pass. Secure only when `NODE_ENV=production` (browsers allow it on localhost otherwise) |
| JWT | HS256 only (`alg: none` refused), issuer + audience checked, 8 h expiry (300 s–7 days configurable), secret ≥ 32 chars and the `.env.example` placeholder refused | Pass (unit tests) |
| Security headers | Live response headers on `/login`, `/api/health`, `/api/auth/me` | Fixed in Stage 9 (§3) |
| `npm audit` | Fresh `npm install` in a clean clone | 0 vulnerabilities |

## 3. Problems found and fixed in Stage 9

| # | Problem (seen on the running server) | Fix | Commit | Test |
|---|---|---|---|---|
| F1 | No security headers at all; `X-Powered-By: Next.js` sent | `headers()` in `next.config.mjs` for every path: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`; `poweredByHeader: false` | "Add security headers and remove X-Powered-By" | `security.test.js` H1–H3 |
| F2 | A login POST with `Sec-Fetch-Site: cross-site` and no `Origin` was accepted | `assertSameOrigin()` also refuses `Sec-Fetch-Site` `cross-site` / `same-site` | "Reject cross-site requests by Sec-Fetch-Site in assertSameOrigin" | `security.test.js` X1–X2 |
| F3 | Public `/api/health` returned `PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86_64-pc-linux-gnu, compiled by gcc …` | Returns only `17.11` | "Report only the PostgreSQL version number from /api/health" | `security.test.js` HL1 |
| F4 | Unlimited password guessing on `/api/auth/login` | In-memory limiter: 5 attempts per email + IP per 15 minutes, reset on success, 429 with `Retry-After`. No new dependency | "Rate-limit login attempts per email and IP (in memory)" | `login-rate-limit.test.js` (7, fake clock); `security.test.js` (5) |
| F5 | Four Stage 3 demonstration routes `/api/demo/*` still deployed, not used by the UI | Removed; the role-guard tests now use real routes, and a test checks the old paths return 404 | "Remove the Stage 3 /api/demo/* routes" | `auth.test.js` "server-side role guards" |

## 4. Secrets

| Check | Command / method | Result |
|---|---|---|
| `.env*` ignored | `.gitignore` has `.env*` and `!.env.example`; `git check-ignore -v .env.local .env .env.production` | All three ignored by `.gitignore:25` |
| Only the template is tracked | `git ls-files \| grep env` | `.env.example` only |
| No env file ever committed | `git log --all --name-only` | Only `.env.example` ever appears |
| `.env.example` has no real values | Read the file | Names plus `replace_with_…` placeholders; the app refuses the placeholder JWT secret |
| Real values never in history | For `POSTGRES_PASSWORD`, `AUTH_JWT_SECRET` and `DATABASE_URL` from `.env.local`: `git log --all -p -S"<value>"` over all 96 commits (values never printed) | **0 commits** for each of the three |
| Secret-like patterns in history | `git log --all -p` searched for `postgres://user:pass@`, `password=`, `secret=`, `JWT_SECRET=`, API keys, private keys, `sk-…`, `ghp_…` | Only test fixtures (`Testpass123`, a unit-test JWT secret), the documented demo password `TalentMatch@2026`, and an early `.env.example` placeholder `change_me`. No real credential |
| `docker-compose.yml` | Read | Uses `${POSTGRES_PASSWORD:?…}` from `.env.local`, no literal password |

No history rewrite is needed.

## 5. Known limitations (not fixed)

**Login rate limiter (F4).**
- The counters live in the memory of one server process: a restart clears them, and several servers behind a load balancer would each count separately. A real deployment would keep them in Redis or a database table.
- **`X-Forwarded-For` can be forged without a proxy (known limitation, accepted).** The IP part of the key comes from `X-Forwarded-For`. Next.js only fills that header with the socket address when the client did **not** send one (`??=` in `next/dist/server/base-server.js`). With no proxy in front of the app, a client can send a different made-up IP on every request and get a fresh 5 attempts for the same email each time.
  - **When it is reliable:** behind a reverse proxy (nginx, a load balancer) that **overwrites** `X-Forwarded-For` with the real client address. The client can no longer choose the value, so the email + IP key works as intended. Any real deployment of this app should run behind such a proxy.
  - **Rejected alternative: a per-email lock.** A second limit on the email alone, whatever the IP, would close the gap. It was rejected because it lets anyone lock out a known user: typing a few wrong passwords for someone else's email would block that person's own login for 15 minutes. That turns a guessing defence into a denial-of-service tool.

**Content-Security-Policy without `script-src` (decision: keep as is).** The CSP sets `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'` and `form-action 'self'`, but does not restrict where scripts may come from. Next.js puts small inline scripts in every page. A strict `script-src` must allow them with a fresh random nonce per request, and the Next.js docs say this requires dynamic rendering of every page: no static or partially prerendered pages and no Cache Components, which this app relies on. Allowing `'unsafe-inline'` instead would make the directive useless against XSS. The remaining XSS defences are React escaping all output, no `dangerouslySetInnerHTML` with user data, and the httpOnly session cookie, which page scripts cannot read.

**No `Strict-Transport-Security` (HSTS) header (decision: keep as is).** HSTS tells the browser "only use HTTPS for this site from now on". Browsers ignore it on plain `http://`, so on `http://localhost` it does nothing. Sending it from a site that is not really on HTTPS can lock users out for the whole `max-age`. It belongs on the HTTPS reverse proxy of a real deployment, which terminates TLS and knows the real domain.

**Stateless JWT.** A copied token stays valid until it expires (max 8 h) unless the account is disabled or its role changes.

**Unused helpers.** `assertOwner()` / `assertOwnerOrAdmin()` in `src/lib/auth/guards.js` were only used by the removed demo routes. Every module checks ownership inside its SQL instead (`WHERE candidate_id = $session`, company comparisons). They are kept because CLAUDE.md names them as the ownership convention.
