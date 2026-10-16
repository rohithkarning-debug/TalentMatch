// Unit tests for the embedding helpers (no server, no database).
// The last group runs the real model; it is downloaded once into
// .cache/transformers (npm run db:embed does this too).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  chunkWords, weightedMeanNormalized, toPgVector, normalizeText, sha256Hex, embedText,
  EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, MAX_CHUNK_TOKENS,
} = await import("../../src/lib/embeddings.js");
const { buildJobEmbeddingText, tryEmbedResume } = await import("../../src/lib/vector-store.js");

const oneTokenEach = () => 1;
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (v) => Math.sqrt(dot(v, v));

describe("chunkWords", () => {
  it("keeps short text in one chunk", () => {
    const { chunks, truncated } = chunkWords(words(10), oneTokenEach, { maxTokens: 20, overlapTokens: 3 });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].tokens, 10);
    assert.equal(truncated, false);
  });

  it("never exceeds maxTokens and overlaps consecutive chunks", () => {
    const { chunks } = chunkWords(words(50), oneTokenEach, { maxTokens: 20, overlapTokens: 5 });
    for (const c of chunks) assert.ok(c.tokens <= 20, `chunk has ${c.tokens} tokens`);
    const first = chunks[0].text.split(" ");
    const second = chunks[1].text.split(" ");
    assert.deepEqual(second.slice(0, 5), first.slice(-5));
    // Every word appears in at least one chunk.
    const seen = new Set(chunks.flatMap((c) => c.text.split(" ")));
    for (const w of words(50)) assert.ok(seen.has(w), `${w} missing`);
  });

  it("does not split words and counts word pieces", () => {
    const pieces = (w) => (w.startsWith("long") ? 4 : 1);
    const { chunks } = chunkWords(["a", "longword", "b", "longer", "c"], pieces, { maxTokens: 6, overlapTokens: 1 });
    for (const c of chunks) assert.ok(c.tokens <= 6);
    assert.ok(chunks.every((c) => !c.text.includes("longwordb")));
  });

  it("stops at maxChunks and reports truncation", () => {
    const { chunks, truncated } = chunkWords(words(1000), oneTokenEach, { maxTokens: 10, overlapTokens: 2, maxChunks: 3 });
    assert.equal(chunks.length, 3);
    assert.equal(truncated, true);
  });

  it("rejects an overlap as large as the chunk", () => {
    assert.throws(() => chunkWords(words(5), oneTokenEach, { maxTokens: 5, overlapTokens: 5 }));
  });
});

describe("vector maths and helpers", () => {
  it("weighted mean is normalised and respects weights", () => {
    const v = weightedMeanNormalized([[1, 0], [0, 1]], [3, 1]);
    assert.ok(Math.abs(norm(v) - 1) < 1e-12);
    assert.ok(v[0] > v[1]);
    assert.ok(Math.abs(v[0] / v[1] - 3) < 1e-12);
  });

  it("refuses a zero vector", () => {
    assert.throws(() => weightedMeanNormalized([[1, 0], [-1, 0]]), /zero vector/);
  });

  it("formats a pgvector literal only for 384 finite numbers", () => {
    const v = new Array(EMBEDDING_DIMENSIONS).fill(0.5);
    assert.match(toPgVector(v), /^\[0\.5(,0\.5){383}\]$/);
    assert.throws(() => toPgVector([1, 2, 3]));
    assert.throws(() => toPgVector([...v.slice(1), Number.NaN]));
  });

  it("hash ignores whitespace-only differences", () => {
    assert.equal(sha256Hex(normalizeText("a  b\n c ")), sha256Hex(normalizeText("a b c")));
    assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
  });

  it("job text = title + description + required skills", () => {
    const text = buildJobEmbeddingText({ title: "ML Engineer", description: "Train  models.", requiredSkills: ["PyTorch", "Python"] });
    assert.equal(text, "ML Engineer. Train models.. Required skills: PyTorch, Python.");
  });

  it("a failing embedder does not throw and stores nothing", async () => {
    let queries = 0;
    const original = console.error;
    console.error = () => {};
    try {
      const ok = await tryEmbedResume(1, "some text", {
        embed: async () => { throw new Error("model unavailable"); },
        query: async () => { queries++; return { rows: [] }; },
      });
      assert.equal(ok, false);
      assert.equal(queries, 0);
    } finally { console.error = original; }
  });
});

describe("embedText with the real model", { timeout: 300_000 }, () => {
  it("returns a 384-dim unit vector with model name and hash", async () => {
    const e = await embedText("Machine learning engineer experienced with PyTorch and NLP.");
    assert.equal(e.vector.length, EMBEDDING_DIMENSIONS);
    assert.ok(Math.abs(norm(e.vector) - 1) < 1e-6);
    assert.equal(e.modelName, EMBEDDING_MODEL);
    assert.equal(e.chunkCount, 1);
    assert.match(e.sourceHash, /^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    const a = await embedText("Frontend developer building React interfaces.");
    const b = await embedText("Frontend developer building React interfaces.");
    assert.ok(dot(a.vector, b.vector) > 0.9999);
  });

  it("chunks long text into several windows", async () => {
    const sentence = "Built data pipelines in Python and deployed machine learning models to production. ";
    const e = await embedText(sentence.repeat(60)); // ~840 words, well over one window
    assert.ok(e.chunkCount >= 3, `expected >=3 chunks, got ${e.chunkCount} (window ${MAX_CHUNK_TOKENS})`);
    assert.ok(Math.abs(norm(e.vector) - 1) < 1e-6);
  });

  it("puts related texts closer than unrelated ones", async () => {
    const [job, ml, fe] = await Promise.all([
      embedText("Machine learning engineer: train NLP models in PyTorch."),
      embedText("I trained transformer text classifiers with PyTorch."),
      embedText("I build responsive React and CSS user interfaces."),
    ]);
    assert.ok(dot(job.vector, ml.vector) > dot(job.vector, fe.vector));
  });
});
