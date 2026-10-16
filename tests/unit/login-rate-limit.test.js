// Stage 9: the in-memory login rate limiter, with a fake clock.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIp, createLoginRateLimiter, loginKey, MAX_ATTEMPTS, WINDOW_MS } from "../../src/lib/auth/login-rate-limit.js";

function limiterAt(start = 1_000_000, options = {}) {
  const clock = { t: start };
  const limiter = createLoginRateLimiter({ now: () => clock.t, ...options });
  return { limiter, clock };
}

describe("login rate limiter", () => {
  it("uses 5 attempts per 15 minutes", () => {
    assert.equal(MAX_ATTEMPTS, 5);
    assert.equal(WINDOW_MS, 15 * 60 * 1000);
  });

  it("allows 5 attempts, then blocks with the remaining wait in seconds", () => {
    const { limiter, clock } = limiterAt();
    for (let i = 0; i < 5; i++) assert.deepEqual(limiter.consume("k"), { allowed: true });
    assert.deepEqual(limiter.consume("k"), { allowed: false, retryAfterSeconds: 900 });
    clock.t += 60_000;
    assert.deepEqual(limiter.consume("k"), { allowed: false, retryAfterSeconds: 840 });
  });

  it("a successful login (reset) starts the count again", () => {
    const { limiter } = limiterAt();
    for (let i = 0; i < 4; i++) limiter.consume("k");
    limiter.reset("k");
    for (let i = 0; i < 5; i++) assert.equal(limiter.consume("k").allowed, true);
    assert.equal(limiter.consume("k").allowed, false);
  });

  it("the window ends 15 minutes after the first attempt", () => {
    const { limiter, clock } = limiterAt();
    for (let i = 0; i < 5; i++) limiter.consume("k");
    clock.t += WINDOW_MS - 1;
    assert.equal(limiter.consume("k").allowed, false);
    clock.t += 1;
    assert.equal(limiter.consume("k").allowed, true);
  });

  it("keys are independent (another email or another IP has its own count)", () => {
    const { limiter } = limiterAt();
    for (let i = 0; i < 6; i++) limiter.consume(loginKey("a@x.example", "1.1.1.1"));
    assert.equal(limiter.consume(loginKey("a@x.example", "1.1.1.1")).allowed, false);
    assert.equal(limiter.consume(loginKey("b@x.example", "1.1.1.1")).allowed, true);
    assert.equal(limiter.consume(loginKey("a@x.example", "2.2.2.2")).allowed, true);
  });

  it("memory stays bounded: expired entries are pruned, then the oldest ones", () => {
    const { limiter, clock } = limiterAt(0, { maxEntries: 3 });
    limiter.consume("old1");
    limiter.consume("old2");
    clock.t += WINDOW_MS; // old1, old2 expired
    limiter.consume("a");
    limiter.consume("b");
    assert.equal(limiter.size, 2);
    limiter.consume("c");
    limiter.consume("d");
    assert.equal(limiter.size, 3);
  });
});

describe("clientIp", () => {
  const headers = (h) => new Headers(h);
  it("takes the first X-Forwarded-For entry, then X-Real-IP, else 'unknown'", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" })), "203.0.113.7");
    assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
    assert.equal(clientIp(headers({})), "unknown");
  });
});
