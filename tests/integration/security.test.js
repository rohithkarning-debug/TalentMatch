// Stage 9: security hardening checks against the production Next.js server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
process.env.TEST_PORT = "3105";
const { startServer } = await import("./helpers.js");

let server;

before(async () => {
  server = await startServer();
});

after(async () => {
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
