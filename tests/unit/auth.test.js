// Unit tests for the auth building blocks (no server, no database).
//   npm run test:unit
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { SignJWT, base64url } from "jose";

const TEST_SECRET = "unit-test-secret-that-is-definitely-long-enough-123";
process.env.AUTH_JWT_SECRET = TEST_SECRET; // isolated from .env.local

const { hashPassword, verifyPassword, BCRYPT_COST } = await import("../../src/lib/auth/password.js");
const { signSessionToken, verifySessionToken, JWT_ISSUER, JWT_AUDIENCE } = await import("../../src/lib/auth/jwt.js");
const { sessionCookieOptions, SESSION_COOKIE } = await import("../../src/lib/auth/cookie.js");
const { registerSchema, loginSchema } = await import("../../src/lib/validation/auth.js");

const key = (s) => new TextEncoder().encode(s);

describe("password hashing (bcryptjs)", () => {
  let hash;
  before(async () => { hash = await hashPassword("Correct1Horse"); });

  it("stores a bcrypt hash, never the plaintext", () => {
    assert.notEqual(hash, "Correct1Horse");
    assert.match(hash, new RegExp(`^\\$2[aby]\\$${BCRYPT_COST}\\$.{53}$`));
  });
  it("accepts the correct password", async () => {
    assert.equal(await verifyPassword("Correct1Horse", hash), true);
  });
  it("rejects a wrong password", async () => {
    assert.equal(await verifyPassword("correct1horse", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });
  it("uses a random salt: same password, different hashes", async () => {
    assert.notEqual(await hashPassword("Correct1Horse"), hash);
  });
  it("returns false (not an error) when the user does not exist", async () => {
    assert.equal(await verifyPassword("anything", null), false);
  });
  it("refuses passwords longer than bcrypt's 72-byte limit", async () => {
    await assert.rejects(hashPassword("a1".repeat(40)), RangeError);
  });
});

describe("JWT session tokens (jose, HS256)", () => {
  it("valid token round-trips id and role", async () => {
    const token = await signSessionToken({ id: 42, role: "candidate" });
    const claims = await verifySessionToken(token);
    assert.equal(claims.userId, 42);
    assert.equal(claims.role, "candidate");
    assert.ok(claims.expiresAt > new Date());
  });
  it("payload contains only sub, role and standard claims (no email, no hash)", async () => {
    const token = await signSessionToken({ id: 7, role: "admin", email: "x@y.example", passwordHash: "$2b$..." });
    const payload = JSON.parse(new TextDecoder().decode(base64url.decode(token.split(".")[1])));
    assert.deepEqual(Object.keys(payload).sort(), ["aud", "exp", "iat", "iss", "role", "sub"]);
  });
  it("rejects a token whose payload was edited (signature mismatch)", async () => {
    const token = await signSessionToken({ id: 42, role: "candidate" });
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    payload.role = "admin";
    const forged = [h, base64url.encode(JSON.stringify(payload)), s].join(".");
    assert.equal(await verifySessionToken(forged), null);
  });
  it("rejects a token signed with a different secret", async () => {
    const token = await new SignJWT({ role: "admin" }).setProtectedHeader({ alg: "HS256" })
      .setSubject("1").setIssuer(JWT_ISSUER).setAudience(JWT_AUDIENCE).setIssuedAt().setExpirationTime("1h")
      .sign(key("some-other-secret-that-is-also-long-enough-xyz"));
    assert.equal(await verifySessionToken(token), null);
  });
  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: "candidate" }).setProtectedHeader({ alg: "HS256" })
      .setSubject("1").setIssuer(JWT_ISSUER).setAudience(JWT_AUDIENCE)
      .setIssuedAt(now - 7200).setExpirationTime(now - 3600).sign(key(TEST_SECRET));
    assert.equal(await verifySessionToken(token), null);
  });
  it('rejects an unsigned token (alg: "none")', async () => {
    const enc = (o) => base64url.encode(JSON.stringify(o));
    const now = Math.floor(Date.now() / 1000);
    const token = `${enc({ alg: "none", typ: "JWT" })}.${enc({ sub: "1", role: "admin", iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: now, exp: now + 3600 })}.`;
    assert.equal(await verifySessionToken(token), null);
  });
  it("rejects wrong audience, garbage and empty tokens", async () => {
    const token = await new SignJWT({ role: "candidate" }).setProtectedHeader({ alg: "HS256" })
      .setSubject("1").setIssuer(JWT_ISSUER).setAudience("someone-else").setIssuedAt().setExpirationTime("1h")
      .sign(key(TEST_SECRET));
    assert.equal(await verifySessionToken(token), null);
    assert.equal(await verifySessionToken("not.a.jwt"), null);
    assert.equal(await verifySessionToken(""), null);
  });
  it("fails loudly without leaking the secret when it is missing or too short", async () => {
    const saved = process.env.AUTH_JWT_SECRET;
    try {
      delete process.env.AUTH_JWT_SECRET;
      await assert.rejects(signSessionToken({ id: 1, role: "admin" }), /AUTH_JWT_SECRET is missing/);
      process.env.AUTH_JWT_SECRET = "short-secret-value";
      await assert.rejects(signSessionToken({ id: 1, role: "admin" }), (err) => {
        assert.ok(!err.message.includes("short-secret-value"), "secret value leaked in error");
        return true;
      });
      process.env.AUTH_JWT_SECRET = "replace_with_a_long_random_secret_at_least_32_chars";
      await assert.rejects(signSessionToken({ id: 1, role: "admin" }), /placeholder/);
    } finally {
      process.env.AUTH_JWT_SECRET = saved;
    }
  });
});

describe("session cookie options", () => {
  it("is httpOnly, SameSite=Lax, path / with a finite max age", () => {
    const o = sessionCookieOptions();
    assert.equal(SESSION_COOKIE, "tm_session");
    assert.equal(o.httpOnly, true);
    assert.equal(o.sameSite, "lax");
    assert.equal(o.path, "/");
    assert.equal(o.maxAge, 8 * 60 * 60);
  });
  it("is Secure only in production", () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      assert.equal(sessionCookieOptions().secure, true);
      process.env.NODE_ENV = "development";
      assert.equal(sessionCookieOptions().secure, false);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe("validation schemas (zod)", () => {
  const valid = { fullName: "Test Person", email: "Test.Person@Mail.Example", password: "abcdef12" };

  it("normalises email to lower case and trims the name", () => {
    const r = registerSchema.parse({ ...valid, fullName: "  Test Person  " });
    assert.equal(r.email, "test.person@mail.example");
    assert.equal(r.fullName, "Test Person");
  });
  it("rejects any extra field such as role", () => {
    for (const extra of [{ role: "admin" }, { role: "recruiter" }, { isAdmin: true }]) {
      assert.equal(registerSchema.safeParse({ ...valid, ...extra }).success, false, JSON.stringify(extra));
    }
  });
  it("enforces password rules", () => {
    for (const password of ["short1", "lettersonly", "12345678", "a1".repeat(37)]) {
      assert.equal(registerSchema.safeParse({ ...valid, password }).success, false, password);
    }
  });
  it("rejects bad emails and missing fields", () => {
    assert.equal(registerSchema.safeParse({ ...valid, email: "not-an-email" }).success, false);
    assert.equal(registerSchema.safeParse({ email: valid.email, password: valid.password }).success, false);
    assert.equal(loginSchema.safeParse({ email: valid.email }).success, false);
  });
});
