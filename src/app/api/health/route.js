import { connection } from "next/server";
import { query } from "@/lib/db";

// GET /api/health — checks that PostgreSQL is reachable and pgvector is installed.
export async function GET() {
  // Always run at request time; never prerender a database check at build time.
  await connection();

  const result = {
    status: "error",
    database: { connected: false, version: null },
    pgvector: { installed: false, version: null },
    checkedAt: new Date().toISOString(),
  };

  try {
    const { rows } = await query("SELECT version() AS version");
    result.database = { connected: true, version: rows[0].version };
  } catch (err) {
    // Log details on the server only; the response stays generic.
    console.error("[health] database check failed:", err.code || err.message);
    return Response.json(result, { status: 503 });
  }

  try {
    const { rows } = await query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );
    if (rows.length > 0) {
      result.pgvector = { installed: true, version: rows[0].extversion };
    }
  } catch (err) {
    console.error("[health] pgvector check failed:", err.code || err.message);
  }

  const healthy = result.database.connected && result.pgvector.installed;
  result.status = healthy ? "ok" : "error";
  return Response.json(result, { status: healthy ? 200 : 503 });
}
