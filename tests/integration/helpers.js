// Helpers for HTTP integration tests against a real Next.js server + database.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.TEST_PORT || 3100);

// Every response body + header seen by the tests, for the secret-leak check.
export const seenResponses = [];

// Start `next start` on a spare port (uses the production build), or use an
// already-running server if TEST_BASE_URL is set.
export async function startServer() {
  if (process.env.TEST_BASE_URL) {
    return { baseUrl: process.env.TEST_BASE_URL.replace(/\/$/, ""), stop: async () => {} };
  }
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error("No production build found. Run `npm run build` first.");
  }
  const baseUrl = `http://localhost:${PORT}`;
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  const health = await fetch(`${baseUrl}/api/health`).catch(() => null);
  if (!health?.ok) {
    child.kill();
    throw new Error(`Server did not become healthy:\n${output}`);
  }
  return {
    baseUrl,
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill();
    }),
  };
}

// Minimal HTTP client. Returns { status, body, text, setCookies, sessionCookie }.
export function makeClient(baseUrl) {
  return async function api(pathname, { method = "GET", json, body, cookie, headers = {} } = {}) {
    const h = { ...headers };
    if (json !== undefined) h["Content-Type"] = "application/json";
    if (cookie !== undefined) h.Cookie = `tm_session=${cookie}`;
    const res = await fetch(baseUrl + pathname, {
      method,
      headers: h,
      body: json !== undefined ? JSON.stringify(json) : body,
      redirect: "manual",
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    const setCookies = res.headers.getSetCookie();
    seenResponses.push(text, ...setCookies, JSON.stringify([...res.headers]));
    const raw = setCookies.find((c) => c.startsWith("tm_session="));
    return {
      status: res.status,
      body: parsed,
      text,
      setCookies,
      sessionCookie: raw ? parseSetCookie(raw) : null,
    };
  };
}

// "tm_session=abc; Path=/; Max-Age=60; HttpOnly"  ->  { value, attrs: { path: "/", "max-age": "60", httponly: true } }
export function parseSetCookie(header) {
  const [pair, ...parts] = header.split(";").map((s) => s.trim());
  const value = pair.slice(pair.indexOf("=") + 1);
  const attrs = {};
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i === -1) attrs[p.toLowerCase()] = true;
    else attrs[p.slice(0, i).toLowerCase()] = p.slice(i + 1);
  }
  return { value, attrs };
}
