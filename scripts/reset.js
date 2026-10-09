// DESTRUCTIVE: drops every TalentMatch table and all of its data, plus the
// migration history, by running db/reset.sql. Afterwards run
// `npm run db:migrate` and `npm run db:seed` to rebuild.
//
//   npm run db:reset              (asks you to type the database name)
//   npm run db:reset -- --yes     (skips the prompt; safety checks still apply)
//
// It only runs when DATABASE_URL points at the local Docker dev database
// (local host + POSTGRES_PORT + POSTGRES_DB from .env.local).

import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { getPool } from "../src/lib/db.js";
import { assertDevDatabase, formatTarget } from "./lib/db-target.js";

const RESET_SQL = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "db", "reset.sql"
);

async function main() {
  const target = assertDevDatabase();

  console.warn("============================================================");
  console.warn(" WARNING: this DELETES all TalentMatch tables and data in");
  console.warn(`   ${formatTarget(target)}`);
  console.warn(" This cannot be undone.");
  console.warn("============================================================");

  if (!process.argv.includes("--yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Type the database name (${target.database}) to confirm: `);
    rl.close();
    if (answer.trim() !== target.database) {
      console.log("Cancelled. Nothing was changed.");
      return;
    }
  }

  const pool = getPool();
  try {
    // Double-check on the server side that we are connected where we think.
    const { rows } = await pool.query("SELECT current_database() AS db");
    if (rows[0].db !== target.database) {
      throw new Error(`Connected to '${rows[0].db}', expected '${target.database}'.`);
    }
    const sql = await readFile(RESET_SQL, "utf8");
    await pool.query(sql);
    console.log("Reset complete. Run `npm run db:migrate` and `npm run db:seed` next.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exitCode = 1;
});
