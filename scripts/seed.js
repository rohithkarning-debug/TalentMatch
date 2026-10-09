// Loads fictional demo data from db/seed/seed.sql in a single transaction.
//
//   npm run db:seed
//
// The seed SQL is idempotent (ON CONFLICT / NOT EXISTS), so running it twice
// does not create duplicates. Like reset, it only targets the dev database.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../src/lib/db.js";
import { assertDevDatabase, formatTarget } from "./lib/db-target.js";

const SEED_SQL = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "db", "seed", "seed.sql"
);

const COUNT_TABLES = [
  "users", "companies", "recruiters", "candidates", "skills", "candidate_skills",
  "jobs", "job_skills", "resumes", "applications", "application_status_history",
  "interviews", "offers", "notifications",
];

async function main() {
  const target = assertDevDatabase();
  console.log(`Seeding ${formatTarget(target)}`);

  const sql = await readFile(SEED_SQL, "utf8");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    const { rows } = await client.query(
      COUNT_TABLES.map((t) => `SELECT '${t}' AS table_name, count(*)::int AS rows FROM ${t}`)
        .join(" UNION ALL ")
    );
    console.table(rows);
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`Seed failed and was rolled back: ${err.message}`);
  } finally {
    client.release();
    await getPool().end();
  }
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exitCode = 1;
});
