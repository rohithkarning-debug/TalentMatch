// Stage 9: security hardening checks against the production Next.js server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
process.env.TEST_PORT = "3105";
const { startServer, makeClient } = await import("./helpers.js");

const RUN = Date.now().toString(36);
let server, api, db;

before(async () => {
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  server = await startServer();
  api = makeClient(server.baseUrl);
});

after(async () => {
  await db?.query("DELETE FROM users WHERE email LIKE $1", [`security.${RUN}.%@test.example`]);
  await db?.end();
  await server?.stop();
});

describe("security headers (next.config.mjs)", () => {
  const EXPECTED = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };

  for (const pathname of ["/login", "/api/health", "/api/auth/me"]) {
    it(`${pathname} sends the security headers and no X-Powered-By`, async () => {
      const res = await fetch(server.baseUrl + pathname, { redirect: "manual" });
      for (const [key, value] of Object.entries(EXPECTED)) {
        assert.equal(res.headers.get(key), value, `${key} on ${pathname}`);
      }
      assert.match(res.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
      assert.equal(res.headers.get("x-powered-by"), null);
    });
  }
});

describe("GET /api/health (public)", () => {
  it("reports only version numbers, not the OS / compiler build string", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.database.version, /^\d+(\.\d+)*/);
    assert.doesNotMatch(JSON.stringify(body), /linux|gcc|compiled|x86|aarch|debian/i);
  });
});

describe("CSRF: assertSameOrigin on state-changing routes", () => {
  const login = (headers) => fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ email: "admin@talentmatch.example", password: "TalentMatch@2026" }),
  });

  it("Sec-Fetch-Site cross-site / same-site is refused even without an Origin header (403, no cookie)", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const res = await login({ "Sec-Fetch-Site": site });
      assert.equal(res.status, 403, site);
      assert.equal((await res.json()).error.code, "CROSS_ORIGIN");
      assert.deepEqual(res.headers.getSetCookie(), []);
    }
  });

  it("a foreign Origin is refused (403); same-origin and non-browser requests pass", async () => {
    const foreign = await login({ Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
    assert.equal(foreign.status, 403);
    const host = new URL(server.baseUrl).host;
    const same = await login({ Origin: `http://${host}`, "Sec-Fetch-Site": "same-origin" });
    assert.equal(same.status, 200, await same.text());
    const noHeaders = await login({});
    assert.equal(noHeaders.status, 200);
  });
});

describe("login rate limiting (5 attempts per email + IP per 15 minutes)", () => {
  const PASSWORD = "Ratelimit123";
  async function account(tag) {
    const email = `security.${RUN}.${tag}@test.example`;
    const reg = await api("/api/auth/register", { method: "POST", json: { fullName: `Rate Limit ${tag}`, email, password: PASSWORD } });
    assert.equal(reg.status, 201, reg.text);
    return email;
  }
  const login = (email, password, ip) => api("/api/auth/login", { method: "POST",
    json: { email, password }, headers: { "X-Forwarded-For": ip } });
  const loginRaw = (email, password, ip) => fetch(`${server.baseUrl}/api/auth/login`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify({ email, password }) });

  it("5 wrong passwords get 401; the 6th attempt gets 429 with Retry-After, even with the right password", async () => {
    const email = await account("locked");
    for (let i = 1; i <= 5; i++) assert.equal((await login(email, "WrongPass1", "203.0.113.10")).status, 401, `attempt ${i}`);

    const blocked = await loginRaw(email, "WrongPass1", "203.0.113.10");
    assert.equal(blocked.status, 429);
    const body = await blocked.json();
    assert.equal(body.error.code, "TOO_MANY_ATTEMPTS");
    assert.match(body.error.message, /Too many failed login attempts\. Try again in 15 minutes\./);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    assert.ok(retryAfter > 0 && retryAfter <= 900, `Retry-After ${retryAfter}`);
    assert.deepEqual(blocked.headers.getSetCookie(), []);

    const correct = await login(email, PASSWORD, "203.0.113.10");
    assert.equal(correct.status, 429, "the correct password does not unlock early");
    assert.equal(correct.sessionCookie, null);
    // The key is email + IP: the same account from another address still works.
    assert.equal((await login(email, PASSWORD, "203.0.113.11")).status, 200);
  });

  it("a successful login resets the count", async () => {
    const email = await account("reset");
    for (let i = 0; i < 4; i++) assert.equal((await login(email, "WrongPass1", "203.0.113.20")).status, 401);
    assert.equal((await login(email, PASSWORD, "203.0.113.20")).status, 200);
    for (let i = 1; i <= 5; i++) assert.equal((await login(email, "WrongPass1", "203.0.113.20")).status, 401, `attempt ${i} after reset`);
    assert.equal((await login(email, "WrongPass1", "203.0.113.20")).status, 429);
  });

  it("unknown emails are limited the same way (the 429 does not reveal whether an account exists)", async () => {
    const email = `security.${RUN}.nobody@test.example`;
    for (let i = 0; i < 5; i++) assert.equal((await login(email, "WrongPass1", "203.0.113.30")).status, 401);
    assert.equal((await login(email, "WrongPass1", "203.0.113.30")).status, 429);
  });

  it("invalid input (400) is not counted", async () => {
    const email = await account("invalid");
    for (let i = 0; i < 8; i++) {
      const res = await api("/api/auth/login", { method: "POST", json: { email }, headers: { "X-Forwarded-For": "203.0.113.40" } });
      assert.equal(res.status, 400);
    }
    assert.equal((await login(email, PASSWORD, "203.0.113.40")).status, 200);
  });

  it("50 parallel wrong attempts: at most 5 reach the password check", async () => {
    const email = await account("parallel");
    const results = await Promise.all(Array.from({ length: 50 }, () => login(email, "WrongPass1", "203.0.113.50")));
    const counts = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
    assert.deepEqual(counts, { 401: 5, 429: 45 });
  });
});
