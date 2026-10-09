// Applies db/migrations/*.sql in filename order, exactly once each.
//
//   npm run db:migrate
//
// Applied migrations are recorded in tm_meta.schema_migrations together with a
// SHA-256 checksum. On later runs, applied files are skipped; if an applied
// file was edited afterwards, the run stops (write a new migration instead).
// Each migration runs inside its own transaction, so a failing file leaves no
// half-applied changes behind.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../src/lib/db.js";
import { describeTarget, formatTarget } from "./lib/db-target.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations"
);
// Any constant works; it just has to be the same for every migrate run.
const MIGRATION_LOCK_ID = 7_281_001;

async function main() {
  console.log(`Target database: ${formatTarget(describeTarget())}`);
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  const client = await getPool().connect();
  try {
    // Prevents two migrate runs from applying the same file at the same time.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    // Bookkeeping lives in its own schema so the application schema (public)
    // contains only the 16 domain tables.
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS tm_meta;
      CREATE TABLE IF NOT EXISTS tm_meta.schema_migrations (
        version     VARCHAR(10)  PRIMARY KEY,
        filename    VARCHAR(255) NOT NULL UNIQUE,
        checksum    CHAR(64)     NOT NULL,
        applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query(
      "SELECT version, filename, checksum FROM tm_meta.schema_migrations"
    );
    const applied = new Map(rows.map((r) => [r.version, r]));

    let appliedNow = 0;
    for (const file of files) {
      const version = file.slice(0, 3);
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      // Normalise line endings so a Windows CRLF checkout of an unchanged
      // file produces the same checksum as the original LF version.
      const checksum = createHash("sha256")
        .update(sql.replace(/\r\n/g, "\n"))
        .digest("hex");
      const previous = applied.get(version);

      if (previous) {
        if (previous.filename !== file || previous.checksum !== checksum) {
          throw new Error(
            `Migration ${file} was changed after it was applied ` +
              `(recorded: ${previous.filename}). Create a new migration instead.`
          );
        }
        console.log(`  skip   ${file} (already applied)`);
        continue;
      }

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO tm_meta.schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
          [version, file, checksum]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`);
      }
      console.log(`  apply  ${file}`);
      appliedNow++;
    }

    console.log(
      `Done: ${appliedNow} applied, ${files.length - appliedNow} already up to date.`
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
    await getPool().end();
  }
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exitCode = 1;
});
