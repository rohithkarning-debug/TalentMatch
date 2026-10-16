import { query as defaultQuery } from "./db.js";
import { EMBEDDING_MODEL, embedText, normalizeText, sha256Hex, toPgVector } from "./embeddings.js";

// Reading and writing resume_embeddings / job_embeddings (migration 007).
// Used by the API routes and by scripts/embed-seed.js (npm run db:embed).
//
// "Not embedded" is simply: no row in the embeddings table. A row is "stale"
// when the text it was made from (source_hash) or the model (model_name) is
// no longer current. Both cases are picked up by embedPending().

// What gets embedded for a job: title, description and the REQUIRED skills.
// Nice-to-have skills are left out so they do not pull the vector towards
// skills the recruiter does not actually need.
export function buildJobEmbeddingText({ title, description, requiredSkills = [] }) {
  const parts = [title, description];
  if (requiredSkills.length) parts.push(`Required skills: ${requiredSkills.join(", ")}.`);
  return normalizeText(parts.join(". "));
}

export async function loadJobEmbeddingText(jobId, query = defaultQuery) {
  const { rows } = await query(
    `SELECT j.title, j.description,
            COALESCE(array_agg(s.name ORDER BY s.name) FILTER (WHERE js.is_required), '{}') AS required_skills
       FROM jobs j
       LEFT JOIN job_skills js ON js.job_id = j.job_id
       LEFT JOIN skills s      ON s.skill_id = js.skill_id
      WHERE j.job_id = $1
      GROUP BY j.job_id`, [jobId]);
  if (!rows.length) return null;
  return buildJobEmbeddingText({ title: rows[0].title, description: rows[0].description, requiredSkills: rows[0].required_skills });
}

// Insert or replace. ON CONFLICT on the primary key makes re-embedding the
// same resume/job an UPDATE instead of an error.
async function saveResumeEmbedding(resumeId, e, query) {
  await query(
    `INSERT INTO resume_embeddings (resume_id, embedding, model_name, chunk_count, source_hash)
     VALUES ($1, $2::vector, $3, $4, $5)
     ON CONFLICT (resume_id) DO UPDATE
        SET embedding = EXCLUDED.embedding, model_name = EXCLUDED.model_name,
            chunk_count = EXCLUDED.chunk_count, source_hash = EXCLUDED.source_hash, created_at = now()`,
    [resumeId, toPgVector(e.vector), e.modelName, e.chunkCount, e.sourceHash]);
}

async function saveJobEmbedding(jobId, e, query) {
  await query(
    `INSERT INTO job_embeddings (job_id, embedding, model_name, chunk_count, source_hash)
     VALUES ($1, $2::vector, $3, $4, $5)
     ON CONFLICT (job_id) DO UPDATE
        SET embedding = EXCLUDED.embedding, model_name = EXCLUDED.model_name,
            chunk_count = EXCLUDED.chunk_count, source_hash = EXCLUDED.source_hash, created_at = now()`,
    [jobId, toPgVector(e.vector), e.modelName, e.chunkCount, e.sourceHash]);
}

export async function embedResume(resumeId, extractedText, { embed = embedText, query = defaultQuery } = {}) {
  const e = await embed(extractedText);
  await saveResumeEmbedding(resumeId, e, query);
  return e;
}

// Call after a job is created or its title / description / skills change.
export async function embedJob(jobId, { embed = embedText, query = defaultQuery } = {}) {
  const text = await loadJobEmbeddingText(jobId, query);
  if (text === null) throw new Error(`Job ${jobId} does not exist`);
  const e = await embed(text);
  await saveJobEmbedding(jobId, e, query);
  return e;
}

// For request handlers: embedding is a best-effort extra. If the model cannot
// load or the resume was deleted meanwhile, the caller's main action (e.g. the
// upload) still succeeds and the item stays "not embedded" until
// `npm run db:embed` (or the next upload) fills it in.
export async function tryEmbed(label, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`[embeddings] could not embed ${label}:`, err?.code || "", err?.message);
    return false;
  }
}

export const tryEmbedResume = (resumeId, text, options) =>
  tryEmbed(`resume ${resumeId}`, () => embedResume(resumeId, text, options));
export const tryEmbedJob = (jobId, options) =>
  tryEmbed(`job ${jobId}`, () => embedJob(jobId, options));

const isStale = (row, text) => row.source_hash === null
  || row.model_name !== EMBEDDING_MODEL
  || row.source_hash !== sha256Hex(normalizeText(text));

// Embed every resume and job that has no embedding, or whose embedding is
// stale. Running it again right away does nothing (idempotent).
export async function embedPending({ embed = embedText, query = defaultQuery, log = () => {} } = {}) {
  const summary = { resumes: { checked: 0, embedded: 0, failed: 0 }, jobs: { checked: 0, embedded: 0, failed: 0 } };

  const resumes = await query(
    `SELECT r.resume_id, r.extracted_text, re.source_hash, re.model_name
       FROM resumes r LEFT JOIN resume_embeddings re ON re.resume_id = r.resume_id
      ORDER BY r.resume_id`);
  for (const row of resumes.rows) {
    summary.resumes.checked++;
    if (!isStale(row, row.extracted_text)) continue;
    try {
      await embedResume(row.resume_id, row.extracted_text, { embed, query });
      summary.resumes.embedded++;
      log(`resume ${row.resume_id}: ${row.source_hash ? "re-embedded (stale)" : "embedded"}`);
    } catch (err) {
      summary.resumes.failed++;
      log(`resume ${row.resume_id}: FAILED (${err.message})`);
    }
  }

  const jobs = await query(
    `SELECT j.job_id, je.source_hash, je.model_name
       FROM jobs j LEFT JOIN job_embeddings je ON je.job_id = j.job_id
      ORDER BY j.job_id`);
  for (const row of jobs.rows) {
    summary.jobs.checked++;
    const text = await loadJobEmbeddingText(row.job_id, query);
    if (text === null || !isStale(row, text)) continue;
    try {
      const e = await embed(text);
      await saveJobEmbedding(row.job_id, e, query);
      summary.jobs.embedded++;
      log(`job ${row.job_id}: ${row.source_hash ? "re-embedded (stale)" : "embedded"}`);
    } catch (err) {
      summary.jobs.failed++;
      log(`job ${row.job_id}: FAILED (${err.message})`);
    }
  }
  return summary;
}
