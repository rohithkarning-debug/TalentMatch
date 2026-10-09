import { Pool } from "pg";

// One shared connection pool for the whole server.
// In development, Next.js hot-reloads modules, so the pool is cached on
// globalThis to avoid opening a new set of connections on every reload.
const globalForDb = globalThis;

export function getPool() {
  if (!globalForDb.talentmatchPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
      );
    }
    globalForDb.talentmatchPool = new Pool({ connectionString, max: 10 });
  }
  return globalForDb.talentmatchPool;
}

// Run a parameterized query: query("SELECT * FROM jobs WHERE id = $1", [id])
export function query(text, params) {
  return getPool().query(text, params);
}
