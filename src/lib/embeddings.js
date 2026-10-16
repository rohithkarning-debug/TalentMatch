import { createHash } from "node:crypto";
import path from "node:path";

// Text -> one 384-dimensional, unit-length vector.
//
// Model: sentence-transformers/all-MiniLM-L6-v2, run locally in Node through
// @huggingface/transformers (ONNX runtime). No text leaves the server.
//
// Pipeline for one document (a resume or a job posting):
//   1. split the text into chunks that fit the model's 256-token window
//   2. embed every chunk (mean of token vectors, then L2-normalised: exactly
//      what sentence-transformers does for this model)
//   3. average the chunk vectors, weighted by how many tokens each chunk has
//   4. L2-normalise the average so it has length 1 again
// Because every stored vector has length 1, cosine similarity is simply the
// dot product, and pgvector's cosine distance (<=>) ranks them correctly.

export const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

// sentence-transformers truncates this model's input at 256 word pieces;
// [CLS] and [SEP] use two of them.
export const MAX_CHUNK_TOKENS = 254;
// Consecutive chunks share ~32 tokens so a sentence cut at a chunk border is
// still seen whole by one of them.
export const CHUNK_OVERLAP_TOKENS = 32;
// Upper bound on work per document (~10,000 tokens, far more than any real
// resume). Text beyond this is not embedded; see docs/vector-design.md.
export const MAX_CHUNKS = 40;
const BATCH_SIZE = 8;

// The model is loaded once per server process and shared by all requests.
// The promise (not the result) is cached so parallel first requests wait for
// the same load instead of starting several. In development, Next.js reloads
// modules, so it lives on globalThis like the database pool.
const globalForModel = globalThis;

export function getExtractor() {
  if (!globalForModel.talentmatchExtractor) {
    globalForModel.talentmatchExtractor = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Model files are downloaded once from the Hugging Face Hub and kept in
      // .cache/transformers (gitignored) so later runs work offline.
      env.cacheDir = path.resolve(process.cwd(), ".cache", "transformers");
      return pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
    })().catch((err) => {
      // Let the next call try again (e.g. after a network error on download).
      globalForModel.talentmatchExtractor = undefined;
      throw err;
    });
  }
  return globalForModel.talentmatchExtractor;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Collapse whitespace so formatting differences (PDF line breaks, double
// spaces) do not change the stored hash or the chunk boundaries.
export function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

// Greedy word-based chunking. Words are never cut in half; a chunk is closed
// when the next word would push it over maxTokens. The next chunk starts with
// the last few words of the previous one (up to overlapTokens).
// countTokens(word) returns how many word pieces the tokenizer makes of it, so
// this function stays pure and is unit-tested with a fake counter.
export function chunkWords(words, countTokens, {
  maxTokens = MAX_CHUNK_TOKENS,
  overlapTokens = CHUNK_OVERLAP_TOKENS,
  maxChunks = MAX_CHUNKS,
} = {}) {
  if (overlapTokens >= maxTokens) throw new Error("overlapTokens must be smaller than maxTokens");
  const chunks = [];
  let current = [];      // [{ word, tokens }]
  let currentTokens = 0;
  let hasNewWord = false; // at least one word not copied from the overlap

  const close = () => {
    chunks.push({ text: current.map((w) => w.word).join(" "), tokens: currentTokens });
    const carried = [];
    let carriedTokens = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      if (carriedTokens + current[i].tokens > overlapTokens) break;
      carried.unshift(current[i]);
      carriedTokens += current[i].tokens;
    }
    current = carried;
    currentTokens = carriedTokens;
    hasNewWord = false;
  };

  for (const word of words) {
    if (!word) continue;
    const tokens = Math.max(1, countTokens(word));
    if (hasNewWord && currentTokens + tokens > maxTokens) {
      close();
      if (chunks.length >= maxChunks) return { chunks, truncated: true };
    }
    // Drop overlap words if the incoming word would not fit next to them.
    while (current.length && currentTokens + tokens > maxTokens) {
      currentTokens -= current.shift().tokens;
    }
    current.push({ word, tokens });
    currentTokens += tokens;
    hasNewWord = true;
  }
  if (hasNewWord) chunks.push({ text: current.map((w) => w.word).join(" "), tokens: currentTokens });
  return { chunks, truncated: false };
}

// Weighted mean of equal-length vectors, then scaled to length 1.
export function weightedMeanNormalized(vectors, weights) {
  if (!vectors.length) throw new Error("No vectors to combine");
  const dims = vectors[0].length;
  const sum = new Float64Array(dims);
  vectors.forEach((v, i) => {
    if (v.length !== dims) throw new Error("Vectors have different lengths");
    const w = weights?.[i] ?? 1;
    for (let d = 0; d < dims; d++) sum[d] += w * v[d];
  });
  const norm = Math.sqrt(sum.reduce((acc, x) => acc + x * x, 0));
  if (!(norm > 0)) throw new Error("Cannot normalise a zero vector");
  return Array.from(sum, (x) => x / norm);
}

// pgvector accepts the text form '[0.1,0.2,...]' and casts it with ::vector.
export function toPgVector(vector) {
  if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite)) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} finite numbers`);
  }
  return `[${vector.join(",")}]`;
}

// Embed one document. Returns everything the *_embeddings tables store.
export async function embedText(rawText) {
  const text = normalizeText(rawText);
  if (!text) throw new Error("Cannot embed empty text");
  const extractor = await getExtractor();
  const countTokens = (word) => extractor.tokenizer.encode(word, { add_special_tokens: false }).length;
  const { chunks, truncated } = chunkWords(text.split(" "), countTokens);

  const chunkVectors = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE).map((c) => c.text);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    const [rows, dims] = output.dims;
    if (dims !== EMBEDDING_DIMENSIONS) throw new Error(`Model returned ${dims} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    for (let r = 0; r < rows; r++) chunkVectors.push(output.data.subarray(r * dims, (r + 1) * dims));
  }

  return {
    vector: weightedMeanNormalized(chunkVectors, chunks.map((c) => c.tokens)),
    chunkCount: chunks.length,
    truncated,
    modelName: EMBEDDING_MODEL,
    sourceHash: sha256Hex(text),
  };
}
