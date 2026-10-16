# TalentMatch — Authentication and Role-Based Access Control (Stage 3)

## 1. Overview

| Piece | Choice | Where |
|---|---|---|
| Password storage | bcrypt hash (`bcryptjs`, cost 12) | `src/lib/auth/password.js` |
| Session | Signed JWT (HS256, `jose`) in an **httpOnly** cookie `tm_session` | `src/lib/auth/jwt.js`, `src/lib/auth/cookie.js` |
| Current user | Verify JWT → re-read the user from PostgreSQL on every request | `src/lib/auth/session.js` |
| Authorization | Server-side guards in every route handler | `src/lib/auth/guards.js` |
| Validation | `zod` schemas shared by API and forms, plus DB CHECK/UNIQUE constraints | `src/lib/validation/auth.js` |
| Errors | One JSON format `{ error: { code, message, details? } }` | `src/lib/api/errors.js` |
| CSRF defence | `SameSite=Lax` cookie + Origin / `Sec-Fetch-Site` check + JSON-only bodies | `src/lib/api/request.js` |
| Security headers (Stage 9) | `nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy; no `X-Powered-By` | `next.config.mjs` |

Roles: `admin`, `recruiter`, `candidate` (the `users.role` CHECK constraint from migration 002).

## 2. Request flow

```
Browser                     Route Handler (server)                         PostgreSQL
───────                     ──────────────────────                         ──────────
POST /api/auth/login  ───►  assertSameOrigin, readJsonBody(loginSchema)
{email, password}           SELECT ... password_hash FROM users WHERE email=$1  ──►
                            bcrypt.compare(password, hash)  (dummy hash if no user)
                            UPDATE users SET last_login_at = now()              ──►
                            signSessionToken({id, role})  -> JWT
                     ◄───   200 {user}  +  Set-Cookie: tm_session=<JWT>; HttpOnly; SameSite=Lax; Secure; Max-Age=28800

GET /api/... (any)    ───►  withAuth / requireUser:
Cookie: tm_session=<JWT>      verifySessionToken(JWT)  -> {userId, role} or null   (signature, alg, iss, aud, exp)
                              SELECT user_id, email, full_name, role, is_active   ──►
                              reject if missing, inactive, or role ≠ token role -> 401
                              assertRole(user, roles)                              -> 403
                              handler(...) with { user }  (+ ownership checks)
                     ◄───   200 / 401 / 403 / 404
```

**Why re-read the user from the database on every request?** The JWT proves *who* you are. The database decides *what you may do right now*. If an admin disables an account or changes a role, the old token stops working on the very next request (integration tests "disabled accounts…" and "does not trust the role inside a token…"). The cost is one primary-key lookup per request.

## 3. Passwords

- `hashPassword()` uses bcrypt with a random salt per password, stored inside the hash (`$2b$12$<salt><hash>`). The same password hashed twice gives two different hashes.
- Cost 12 makes each guess slow for an attacker (measured: ~270 ms per comparison with bcryptjs on the dev machine). The seeded demo accounts use cost 10; verification works for both because the cost is part of the hash.
- bcrypt only reads the first **72 bytes**. Longer passwords are rejected by validation, so two long passwords can never collide.
- The database also enforces `users_password_hash_bcrypt_check`, so a plaintext password cannot be stored even by mistake (Stage 1, test 7).
- **Login does not reveal which emails exist.** An unknown email still runs one bcrypt comparison against a dummy hash, and both "unknown email" and "wrong password" return the identical body `401 INVALID_CREDENTIALS`.

## 4. JWT and cookie

**JWT payload:**
```json
{ "role": "candidate", "sub": "18", "iss": "talentmatch", "aud": "talentmatch-web", "iat": 1791..., "exp": 1791... }
```
- It contains only the user id and role. There is no email, no name and no hash: a JWT is signed, not encrypted, so anyone holding it can read it.
- **Verification** (`verifySessionToken`) accepts only HS256 (so `alg: none` is rejected), checks the signature, issuer, audience and expiry, and requires `sub`, `iat` and `exp`. Any failure returns `null` → 401. A missing or too-short secret, or the `.env.example` placeholder, throws a configuration error that never contains the secret value.

**Cookie `tm_session`:**

| Attribute | Value | Why |
|---|---|---|
| HttpOnly | yes | JavaScript in the page (including injected scripts) cannot read the token |
| SameSite | Lax | Not sent on cross-site POST/fetch, which blocks CSRF. Normal links into the site keep you logged in |
| Secure | in production (`next start`) | HTTPS only. Browsers treat `http://localhost` as secure, so local testing works |
| Path | `/` | Sent to every route |
| Max-Age | 28800 s (8 h), configurable | Matches the JWT `exp` |

Tokens are **never** stored in `localStorage` or `sessionStorage`. The forms only call the API, and the browser stores the cookie.

**Logout** overwrites the cookie with an empty value and `Max-Age=0`, using the same name, path and flags.

**Extra CSRF layers:**
- `assertSameOrigin()` rejects state-changing requests whose `Origin` header is a different site (403 `CROSS_ORIGIN`). Since Stage 9 it also rejects `Sec-Fetch-Site: cross-site` or `same-site` even when `Origin` is missing. Browsers set that header themselves and a web page cannot change it. Requests with neither header (curl, the tests) are not from a browser, so CSRF does not apply to them.
- Login and register accept only `Content-Type: application/json` (415 otherwise). An HTML form on another site cannot send JSON.

## 5. Authorization helpers (`src/lib/auth/guards.js`)

| Helper | Use |
|---|---|
| `withAuth({ roles? }, handler)` | Route wrapper: 401 if not logged in, 403 if the role is not listed, then `handler(request, { user, params })`. Converts thrown errors into the JSON format. |
| `withErrorHandling(handler)` | Same error handling for public routes (login, register) |
| `requireUser(request)` | Returns the user or throws 401 |
| `requireRole(request, ...roles)` / `requireAdmin` / `requireRecruiter` / `requireCandidate` | 401/403 |
| `assertRole(user, roles)` | 403 if the role is not allowed |
| `assertOwner(user, ownerUserId)` | 403 unless the record belongs to the user |
| `assertOwnerOrAdmin(user, ownerUserId)` | Same, but admins pass |
| `getCurrentUser()` (`session.js`) | For Server Components (reads `cookies()`). Must be inside `<Suspense>` because Cache Components is on |

**Pattern for every protected route in later stages:**
```js
export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user, params }) => {
  const id = idParamSchema.parse(params.id);                         // 1. validate input
  const { rows } = await query("SELECT candidate_id, ... FROM applications WHERE application_id = $1", [id]);
  if (!rows[0]) throw notFound();                                    // 2. load record
  assertOwner(user, rows[0].candidate_id);                           // 3. owner comes from the DB, never the request
  return NextResponse.json(...);
});
```

The UI may hide buttons for convenience, but that is never the protection: every route checks on the server. No `proxy.js` (formerly middleware) is used, so authorization never depends on one.

### Role permission matrix (Stage 3 endpoints)

| Endpoint | Anonymous | Candidate | Recruiter | Admin |
|---|---|---|---|---|
| `POST /api/auth/register` | ✅ (creates candidate only) | ✅ | ✅ | ✅ |
| `POST /api/auth/login` / `logout` | ✅ | ✅ | ✅ | ✅ |
| `GET /api/auth/me` | 401 | ✅ | ✅ | ✅ |
| `GET /api/demo/admin` | 401 | 403 | 403 | ✅ |
| `GET /api/demo/recruiter` | 401 | 403 | ✅ | 403 |
| `GET /api/demo/candidate` | 401 | ✅ | 403 | 403 |
| `GET /api/demo/users/:id` | 401 | own id only | own id only | any id |

Admin and recruiter accounts are **never** created through public registration. The register schema is strict, so any `role` field is rejected with 400 and nothing is saved, and the SQL hard-codes `'candidate'`. Admin-managed recruiter creation comes in a later stage.

## 6. API reference

All responses are JSON with `Cache-Control: no-store`. Errors look like:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input",
             "details": { "formErrors": [], "fieldErrors": { "password": ["Password must be at least 8 characters"] } } } }
```

### `POST /api/auth/register`
```bash
curl -i -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" \
     -d '{"fullName":"Riya Test","email":"riya.test@mail.example","password":"Example123"}'
```
Rules:
- `fullName`: 2–120 characters.
- `email`: valid, stored lower-case.
- `password`: 8+ characters, at most 72 bytes, at least one letter and one number.
- No other fields are allowed.

Creates `users` (role `candidate`) and `candidates` in **one transaction**, then logs the user in.

| Status | When |
|---|---|
| 201 | `{ "user": { "id", "email", "fullName", "role": "candidate" } }` + Set-Cookie |
| 400 `VALIDATION_ERROR` | Invalid fields, extra fields (e.g. `role`), malformed JSON |
| 403 `CROSS_ORIGIN` | Origin header from another site, or `Sec-Fetch-Site: cross-site` / `same-site` |
| 409 `EMAIL_TAKEN` | Email already registered (any letter case) |
| 413 / 415 | Body > 16 KB / not `application/json` |

### `POST /api/auth/login`
```bash
curl -i -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
     -d '{"email":"admin@talentmatch.example","password":"TalentMatch@2026"}'
```
| Status | When |
|---|---|
| 200 | `{ "user": {...} }` + Set-Cookie; `last_login_at` updated |
| 400 | Missing or invalid fields |
| 401 `INVALID_CREDENTIALS` | Wrong password **or** unknown email (identical response) |
| 403 `ACCOUNT_DISABLED` | Correct password but `is_active = false` |

### `POST /api/auth/logout`
Always 200 `{ "ok": true }`, and clears the cookie (`Max-Age=0`).

### `GET /api/auth/me`
```bash
curl -i http://localhost:3000/api/auth/me -b "tm_session=<token>"
```
200 `{ "user": { "id", "email", "fullName", "role" } }`, or 401 `UNAUTHORIZED` when there is no session or it is invalid, expired, disabled, or its role is stale.

### Demo endpoints (Stage 3 only)
`/api/demo/admin`, `/api/demo/recruiter`, `/api/demo/candidate`, `/api/demo/users/:id`. They return only the caller's safe profile, or for `users/:id` the requested safe profile. They exist to demonstrate and test the guards, and can be removed once the real modules exist.

## 7. Frontend

- `/login` and `/register` are client components (`src/components/auth/`).
- Fields are validated with the **same zod schema** as the API, for instant feedback.
- Loading state on submit; field errors and a general alert come from the API's `details`. Registration also has a confirm-password check.
- On success the server sets the cookie and the page navigates to `/`.
- Registration has no role field; it always creates a candidate.
- `/` shows "Signed in as …" with a Sign out button, or Sign in / Create account links. The session part streams in behind `<Suspense>`, as Cache Components requires.

## 8. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | From Stage 0 |
| `AUTH_JWT_SECRET` | yes | ≥ 32 random characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. The `.env.example` placeholder is refused at runtime |
| `AUTH_SESSION_MAX_AGE_SECONDS` | no | Default 28800 (8 h), allowed 300–604800 |

Changing `AUTH_JWT_SECRET` logs everyone out: old tokens no longer verify.

## 9. Tests

There is no test framework dependency. The tests use Node's built-in `node:test` runner.

```powershell
npm run test:unit          # 20 tests: bcrypt, JWT, cookie options, zod schemas (no server/DB)
npm run build              # integration tests run against the production build
npm run test:integration   # 24 tests: starts `next start` on port 3100, real HTTP + PostgreSQL
npm test                   # both
```
Integration tests create accounts named `authtest.<run>.<n>@test.example` through the API and delete them afterwards. The seeded demo accounts (password `TalentMatch@2026`, see README) are only logged into, never modified. To test an already-running server instead, set `TEST_BASE_URL=http://localhost:3000`.

Results are recorded in [test-cases.md](test-cases.md#stage-3--authentication-and-rbac).

## 10. Limitations (known, acceptable for this project)

- **Stateless JWT.** Logout clears the browser cookie, but a token copied before logout stays valid until it expires (max 8 h). Disabling the account or changing its role invalidates it immediately (DB check). A server-side revocation list (`jti` deny-list) would be the next step.
- **No rate limiting or lockout** on login. bcrypt cost 12 slows guessing but does not stop it. A production deployment would add per-IP and per-account limits.
- **Registration reveals that an email exists** (409 `EMAIL_TAKEN`). This is the usual sign-up trade-off; login itself does not reveal it.
- **No email verification or password reset** in this project's scope.
- **No `script-src` Content-Security-Policy** (Stage 9). The CSP only sets `frame-ancestors`, `base-uri`, `object-src` and `form-action`. Restricting scripts needs a fresh nonce per request, which forces every page to render dynamically and conflicts with Cache Components / partial prerendering. React escapes all output, which is the main XSS defence here.
- **No HSTS header.** It only means something over HTTPS and belongs to the HTTPS proxy of a real deployment; on `http://localhost` browsers ignore it.

The full Stage 9 route-by-route review is in [security-review.md](security-review.md).
