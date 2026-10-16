// In-memory login rate limiter (no dependency, no framework imports).
//
// Rule: at most MAX_ATTEMPTS login attempts per (email + IP) in a
// WINDOW_MS window that starts with the first attempt. A successful login
// resets the counter, so only FAILED attempts add up in practice.
//
// The attempt is counted BEFORE the password is checked. bcrypt is slow and
// asynchronous: if we counted only after a failure, 50 parallel requests
// would all pass the "fewer than 5?" check before the first one finished.
// consume() is synchronous, so in Node's single thread every request is
// counted the moment it arrives and at most 5 ever reach bcrypt.
//
// Limitations (see docs/security-review.md): the counters live in this
// server process (lost on restart, not shared between several servers), and
// the IP comes from X-Forwarded-For, which a client can set itself when no
// trusted proxy is in front of the app.

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 10_000; // bounds memory if many emails/IPs are tried

export function createLoginRateLimiter({ maxAttempts = MAX_ATTEMPTS, windowMs = WINDOW_MS,
  maxEntries = MAX_ENTRIES, now = Date.now } = {}) {
  const entries = new Map(); // key -> { count, resetAt }

  function prune(t) {
    for (const [key, e] of entries) if (e.resetAt <= t) entries.delete(key);
    // Still full: drop the oldest (a Map keeps insertion order) until there
    // is room for the entry about to be added.
    for (const key of entries.keys()) {
      if (entries.size < maxEntries) break;
      entries.delete(key);
    }
  }

  return {
    // Counts one attempt. Returns { allowed: true } or
    // { allowed: false, retryAfterSeconds } when the limit is reached.
    consume(key) {
      const t = now();
      let e = entries.get(key);
      if (e && e.resetAt <= t) { entries.delete(key); e = undefined; }
      if (!e) {
        if (entries.size >= maxEntries) prune(t);
        e = { count: 0, resetAt: t + windowMs };
        entries.set(key, e);
      }
      if (e.count >= maxAttempts) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((e.resetAt - t) / 1000)) };
      }
      e.count += 1;
      return { allowed: true };
    },
    // Successful login: forget the failures for this key.
    reset(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}

// The client IP: the first X-Forwarded-For entry (Next.js fills it with the
// socket address when the client sent none), else X-Real-IP.
export function clientIp(headers) {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

export const loginKey = (email, ip) => `${email}|${ip}`;

// One limiter for the whole server process.
export const loginRateLimiter = createLoginRateLimiter();
