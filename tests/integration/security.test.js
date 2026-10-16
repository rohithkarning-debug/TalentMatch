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
