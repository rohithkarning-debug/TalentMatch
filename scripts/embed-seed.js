// Embeds every resume and job that has no embedding yet (or a stale one).
//
//   npm run db:embed
//
// Idempotent: a second run finds nothing to do. Safe to run after db:seed,
// after a failed embedding during upload, or after switching models.
// The first run downloads the model (~90 MB) into .cache/transformers.

import { getPool } from "../src/lib/db.js";
import { EMBEDDING_MODEL } from "../src/lib/embeddings.js";
import { embedPending } from "../src/lib/vector-store.js";
import { describeTarget, formatTarget } from "./lib/db-target.js";

async function main() {
  console.log(`Embedding into ${formatTarget(describeTarget())} with ${EMBEDDING_MODEL}`);
  const started = Date.now();
  try {
    const summary = await embedPending({ log: (line) => console.log(`  ${line}`) });
    console.table(summary);
    const { rows } = await getPool().query(
      `SELECT 'resumes' AS table_name, count(*)::int AS rows,
              (SELECT count(*)::int FROM resume_embeddings) AS embedded FROM resumes
       UNION ALL
       SELECT 'jobs', count(*)::int, (SELECT count(*)::int FROM job_embeddings) FROM jobs`);
    console.table(rows);
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (summary.resumes.failed || summary.jobs.failed) process.exitCode = 1;
  } finally {
    await getPool().end();
  }
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exitCode = 1;
});
