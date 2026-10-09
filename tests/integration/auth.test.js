// Integration tests: real HTTP requests to a real Next.js server + PostgreSQL.
//   npm run build            (once, or after code changes)
//   npm run test:integration
//
// Test accounts are created through the API with emails like
// authtest.<run>.<n>@test.example and are deleted again in after().
// Seeded demo accounts (README, password TalentMatch@2026) are only logged into, never changed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { SignJWT, base64url } from "jose";
import pg from "pg";
import { makeClient, seenResponses, startServer } from "./helpers.js";

const DEMO_PASSWORD = "TalentMatch@2026"; // documented in README.md
const SEEDED = {
  admin: "admin@talentmatch.example",
  recruiter: "meera.iyer@nimbusanalytics.example",
  candidate: "aditi.sharma@mail.example",
};
const RUN = Date.now().toString(36);
let counter = 0;
const testEmail = () => `authtest.${RUN}.${++counter}@test.example`;
const SAFE_USER_KEYS = ["email", "fullName", "id", "role"];

let server, api, db;
const jwtKey = () => new TextEncoder().encode(process.env.AUTH_JWT_SECRET);

async function signToken({ sub, role, exp = "1h", iat }) {
  let jwt = new SignJWT({ role }).setProtectedHeader({ alg: "HS256" })
    .setSubject(String(sub)).setIssuer("talentmatch").setAudience("talentmatch-web");
  jwt = iat ? jwt.setIssuedAt(iat) : jwt.setIssuedAt();
  return jwt.setExpirationTime(exp).sign(jwtKey());
}

async function login(email, password = DEMO_PASSWORD) {
  const r = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return { user: r.body.user, cookie: r.sessionCookie.value };
}

async function register(overrides = {}) {
  const payload = { fullName: "Auth Test User", email: testEmail(), password: "Testpass123", ...overrides };
  const r = await api("/api/auth/register", { method: "POST", json: payload });
  return { r, payload };
}

before(async () => {
  assert.ok(process.env.AUTH_JWT_SECRET, "AUTH_JWT_SECRET must be set (.env.local)");
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  server = await startServer();
  api = makeClient(server.baseUrl);
});

after(async () => {
  // Remove every account this run created (cascades to candidates rows).
  await db?.query("DELETE FROM users WHERE email LIKE $1", [`authtest.${RUN}.%@test.example`]);
  await db?.end();
  await server?.stop();
});

describe("POST /api/auth/register", () => {
  it("creates a candidate, hashes the password and sets a secure session cookie (201)", async () => {
    const { r, payload } = await register();
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(Object.keys(r.body.user).sort(), SAFE_USER_KEYS);
    assert.equal(r.body.user.role, "candidate");
    assert.equal(r.body.user.email, payload.email);

    const c = r.sessionCookie;
    assert.ok(c && c.value.split(".").length === 3, "JWT cookie missing");
    assert.equal(c.attrs.httponly, true);
    assert.equal(c.attrs.samesite.toLowerCase(), "lax");
    assert.equal(c.attrs.path, "/");
    assert.equal(c.attrs["max-age"], "28800");
    assert.equal(c.attrs.secure, true, "production build must set Secure");

    const { rows } = await db.query(
      `SELECT u.password_hash, u.role, c.user_id AS candidate_id
         FROM users u LEFT JOIN candidates c ON c.user_id = u.user_id WHERE u.email = $1`,
      [payload.email]
    );
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].password_hash, payload.password, "plaintext stored!");
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$.{53}$/);
    assert.equal(await bcrypt.compare(payload.password, rows[0].password_hash), true);
    assert.equal(rows[0].role, "candidate");
    assert.ok(rows[0].candidate_id, "candidate profile row not created in the same transaction");
  });

  it("rejects a duplicate email, including a different letter case (409)", async () => {
    const { r: first, payload } = await register();
    assert.equal(first.status, 201);
    const again = await register({ email: payload.email });
    assert.equal(again.r.status, 409);
    assert.equal(again.r.body.error.code, "EMAIL_TAKEN");
    const upper = await register({ email: payload.email.toUpperCase() });
    assert.equal(upper.r.status, 409);
  });

  it("rejects invalid input with field errors (400)", async () => {
    const cases = [
      [{ email: "not-an-email" }, "email"],
      [{ password: "short1" }, "password"],
      [{ password: "nodigitshere" }, "password"],
      [{ password: "x1".repeat(40) }, "password"],
      [{ fullName: " " }, "fullName"],
    ];
    for (const [override, field] of cases) {
      const { r } = await register(override);
      assert.equal(r.status, 400, JSON.stringify(override));
      assert.equal(r.body.error.code, "VALIDATION_ERROR");
      assert.ok(r.body.error.details.fieldErrors[field], `no error for ${field}`);
    }
    const missing = await api("/api/auth/register", { method: "POST", json: { email: testEmail() } });
    assert.equal(missing.status, 400);
  });

  it("cannot create privileged accounts: any role field is rejected and nothing is saved (400)", async () => {
    for (const extra of [{ role: "admin" }, { role: "recruiter" }, { role: "candidate" }, { isAdmin: true }]) {
      const { r, payload } = await register(extra);
      assert.equal(r.status, 400, JSON.stringify(extra));
      const { rowCount } = await db.query("SELECT 1 FROM users WHERE email = $1", [payload.email]);
      assert.equal(rowCount, 0, `user created despite ${JSON.stringify(extra)}`);
    }
  });

  it("rejects non-JSON (415), malformed JSON (400) and cross-site requests (403)", async () => {
    const form = await api("/api/auth/register", {
      method: "POST", body: "email=a@b.example", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assert.equal(form.status, 415);
    const bad = await api("/api/auth/register", { method: "POST", body: "{oops", headers: { "Content-Type": "application/json" } });
    assert.equal(bad.status, 400);
    const cross = await api("/api/auth/register", {
      method: "POST", json: { fullName: "X Y", email: testEmail(), password: "Testpass123" },
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error.code, "CROSS_ORIGIN");
  });
});

describe("POST /api/auth/login", () => {
  it("logs in seeded admin, recruiter and candidate with the correct password (200)", async () => {
    for (const [role, email] of Object.entries(SEEDED)) {
      const r = await api("/api/auth/login", { method: "POST", json: { email, password: DEMO_PASSWORD } });
      assert.equal(r.status, 200, `${role}: ${r.text}`);
      assert.equal(r.body.user.role, role);
      assert.deepEqual(Object.keys(r.body.user).sort(), SAFE_USER_KEYS);
      assert.ok(r.sessionCookie?.value);
      assert.ok(!r.text.includes("$2b$") && !/password/i.test(r.text), "hash/password leaked");
    }
  });

  it("accepts the email in any letter case", async () => {
    const r = await api("/api/auth/login", { method: "POST", json: { email: SEEDED.candidate.toUpperCase(), password: DEMO_PASSWORD } });
    assert.equal(r.status, 200);
  });

  it("gives the same generic 401 for a wrong password and an unknown email", async () => {
    const wrong = await api("/api/auth/login", { method: "POST", json: { email: SEEDED.admin, password: "WrongPass123" } });
    const unknown = await api("/api/auth/login", { method: "POST", json: { email: "nobody@test.example", password: "WrongPass123" } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");
    assert.equal(wrong.sessionCookie, null, "no cookie on failed login");
  });

  it("rejects invalid login input (400)", async () => {
    for (const json of [{ email: SEEDED.admin }, { email: "bad", password: "x" }, { password: "x" }]) {
      const r = await api("/api/auth/login", { method: "POST", json });
      assert.equal(r.status, 400, JSON.stringify(json));
    }
  });

  it("records last_login_at without changing updated_at (migration 014)", async () => {
    const before = (await db.query("SELECT last_login_at, updated_at FROM users WHERE email = $1", [SEEDED.recruiter])).rows[0];
    await login(SEEDED.recruiter);
    const after = (await db.query("SELECT last_login_at, updated_at FROM users WHERE email = $1", [SEEDED.recruiter])).rows[0];
    assert.ok(after.last_login_at && (!before.last_login_at || after.last_login_at > before.last_login_at));
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
  });

  it("disabled accounts cannot log in (403) and their existing sessions stop working (401)", async () => {
    const { r, payload } = await register();
    const cookie = r.sessionCookie.value;
    assert.equal((await api("/api/auth/me", { cookie })).status, 200);
    await db.query("UPDATE users SET is_active = FALSE WHERE email = $1", [payload.email]);
    const relogin = await api("/api/auth/login", { method: "POST", json: { email: payload.email, password: payload.password } });
    assert.equal(relogin.status, 403);
    assert.equal(relogin.body.error.code, "ACCOUNT_DISABLED");
    assert.equal((await api("/api/auth/me", { cookie })).status, 401);
  });
});

describe("GET /api/auth/me and JWT validation", () => {
  it("returns 401 without a session", async () => {
    const r = await api("/api/auth/me");
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, "UNAUTHORIZED");
  });

  it("returns only safe fields for a valid session", async () => {
    const { cookie, user } = await login(SEEDED.candidate);
    const r = await api("/api/auth/me", { cookie });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user, user);
    assert.deepEqual(Object.keys(r.body.user).sort(), SAFE_USER_KEYS);
    assert.ok(!r.text.includes("$2b$") && !/password|hash|is_active/i.test(r.text));
  });

  it("rejects garbage, tampered, wrong-secret, unsigned and expired tokens (401)", async () => {
    const { cookie, user } = await login(SEEDED.candidate);
    const [h, p, s] = cookie.split(".");
    const payload = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    const tampered = [h, base64url.encode(JSON.stringify({ ...payload, role: "admin" })), s].join(".");
    const wrongSecret = await new SignJWT({ role: "candidate" }).setProtectedHeader({ alg: "HS256" })
      .setSubject(String(user.id)).setIssuer("talentmatch").setAudience("talentmatch-web")
      .setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode("x".repeat(64)));
    const enc = (o) => base64url.encode(JSON.stringify(o));
    const unsigned = `${enc({ alg: "none" })}.${enc({ ...payload, role: "candidate" })}.`;
    const now = Math.floor(Date.now() / 1000);
    const expired = await signToken({ sub: user.id, role: "candidate", iat: now - 7200, exp: now - 60 });

    for (const [name, token] of Object.entries({ garbage: "abc.def.ghi", tampered, wrongSecret, unsigned, expired })) {
      const r = await api("/api/auth/me", { cookie: token });
      assert.equal(r.status, 401, name);
    }
  });

  it("does not trust the role inside a token when it differs from the database (401)", async () => {
    const { user } = await login(SEEDED.candidate);
    const forgedAdmin = await signToken({ sub: user.id, role: "admin" }); // validly signed, wrong role
    assert.equal((await api("/api/auth/me", { cookie: forgedAdmin })).status, 401);
    assert.equal((await api("/api/demo/admin", { cookie: forgedAdmin })).status, 401);
    const ghost = await signToken({ sub: 987654321, role: "candidate" }); // user does not exist
    assert.equal((await api("/api/auth/me", { cookie: ghost })).status, 401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie (Max-Age=0, same flags) and the browser is then logged out", async () => {
    const { cookie } = await login(SEEDED.candidate);
    const r = await api("/api/auth/logout", { method: "POST", cookie });
    assert.equal(r.status, 200);
    const c = r.sessionCookie;
    assert.equal(c.value, "");
    assert.equal(c.attrs["max-age"], "0");
    assert.equal(c.attrs.httponly, true);
    assert.equal(c.attrs.path, "/");
    // What the browser sends afterwards: an empty cookie -> 401
    assert.equal((await api("/api/auth/me", { cookie: c.value })).status, 401);
  });

  it("is safe to call without a session (200)", async () => {
    assert.equal((await api("/api/auth/logout", { method: "POST" })).status, 200);
  });
});

describe("server-side role guards (demo routes)", () => {
  const routes = ["admin", "recruiter", "candidate"];

  it("reject unauthenticated requests (401)", async () => {
    for (const r of routes) assert.equal((await api(`/api/demo/${r}`)).status, 401, r);
  });

  for (const [role, email] of Object.entries(SEEDED)) {
    it(`${role}: 200 on /api/demo/${role}, 403 on the other two`, async () => {
      const { cookie } = await login(email);
      for (const r of routes) {
        const res = await api(`/api/demo/${r}`, { cookie });
        assert.equal(res.status, r === role ? 200 : 403, `${role} -> ${r}`);
        if (r !== role) assert.equal(res.body.error.code, "FORBIDDEN");
      }
    });
  }
});

describe("ownership checks (GET /api/demo/users/:id)", () => {
  it("own record 200, someone else's 403, admin any 200 / missing 404, bad id 400, anonymous 401", async () => {
    const cand = await login(SEEDED.candidate);
    const rec = await login(SEEDED.recruiter);
    const admin = await login(SEEDED.admin);

    assert.equal((await api(`/api/demo/users/${cand.user.id}`, { cookie: cand.cookie })).status, 200);
    assert.equal((await api(`/api/demo/users/${rec.user.id}`, { cookie: cand.cookie })).status, 403);
    assert.equal((await api(`/api/demo/users/${cand.user.id}`, { cookie: rec.cookie })).status, 403);
    const asAdmin = await api(`/api/demo/users/${cand.user.id}`, { cookie: admin.cookie });
    assert.equal(asAdmin.status, 200);
    assert.deepEqual(Object.keys(asAdmin.body.user).sort(), SAFE_USER_KEYS);
    assert.equal((await api("/api/demo/users/987654321", { cookie: admin.cookie })).status, 404);
    assert.equal((await api("/api/demo/users/abc", { cookie: admin.cookie })).status, 400);
    assert.equal((await api(`/api/demo/users/${cand.user.id}`)).status, 401);
  });
});

describe("secrets are never exposed", () => {
  it("no response body or header contained the JWT secret, the DB password or a password hash", () => {
    const secrets = [process.env.AUTH_JWT_SECRET, process.env.POSTGRES_PASSWORD].filter(Boolean);
    assert.ok(seenResponses.length > 50, "expected many recorded responses");
    for (const text of seenResponses) {
      for (const secret of secrets) assert.ok(!text.includes(secret), "secret found in a response");
      assert.ok(!/\$2[aby]\$\d\d\$/.test(text), "bcrypt hash found in a response");
    }
  });

  it("no tracked file contains the secrets, and .env.local is not tracked", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
    assert.ok(!tracked.includes(".env.local"));
    for (const secret of [process.env.AUTH_JWT_SECRET, process.env.POSTGRES_PASSWORD].filter(Boolean)) {
      let found = "";
      try {
        found = execFileSync("git", ["grep", "-l", "-F", "--cached", secret], { encoding: "utf8" });
      } catch (err) {
        if (err.status !== 1) throw err; // exit 1 = no match (good)
      }
      assert.equal(found.trim(), "", "secret found in a tracked/staged file");
    }
  });
});
