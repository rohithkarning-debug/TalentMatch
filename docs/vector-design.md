# TalentMatch — Vector Design (Stage 5: semantic matching with pgvector)

Files: `src/lib/embeddings.js` (model + chunking), `src/lib/vector-store.js` (read/write embeddings),
`scripts/embed-seed.js` (`npm run db:embed`), `db/migrations/007_vector_embeddings.sql` (tables + HNSW),
`db/migrations/015_rank_candidates_for_job.sql` (ranking function),
`src/app/api/recruiter/jobs/[jobId]/matches/route.js` (API).

All numbers below are real outputs from the seeded database on 2026-10-16 (PostgreSQL 17.11, pgvector 0.8.7).

---

## 1. Why vectors at all

Keyword matching misses meaning. A resume that says *"trained transformer text classifiers"* is a strong
fit for a job asking for *"NLP pipelines"*, yet the two share almost no words. A sentence-embedding model
turns each text into a list of 384 numbers (a **vector**) so that texts with similar meaning get vectors
pointing in similar directions. Comparing two vectors gives a number between about 0 (unrelated) and 1
(same meaning). That is the **match score**.

The skills tables (`candidate_skills`, `job_skills`) are still used next to the vector. They give an
explainable "3 of 3 required skills" count. The vector catches what the skills list misses (experience
described in sentences, related technologies, seniority wording).

## 2. What data is embedded

| Item | Text that is embedded | When |
|---|---|---|
| Resume | `resumes.extracted_text` (the text extracted from the uploaded PDF/TXT) | Right after an upload is committed; `npm run db:embed` for seeded or missed rows |
| Job | `title + ". " + description + ". Required skills: A, B, C."` (`buildJobEmbeddingText`) | `embedJob(jobId)` / `npm run db:embed` (see §9: recruiter job editing is not built yet) |

Only **required** job skills go into the job text. Nice-to-have skills would pull the job vector towards
skills the recruiter does not actually need.

Every resume is embedded, not only the primary one, so changing the primary resume needs no new embedding.
Ranking uses the **primary** resume (`resumes.is_primary`, at most one per candidate thanks to the partial
unique index `resumes_one_primary_per_candidate`).

Before hashing and chunking, whitespace is collapsed (`normalizeText`), so PDF line breaks don't change anything.

## 3. The model and why it was chosen

**`sentence-transformers/all-MiniLM-L6-v2`**, run **locally inside Node.js** with `@huggingface/transformers`
(ONNX runtime, fp32 weights from the official model repository).

| Reason | Detail |
|---|---|
| Made for this task | Trained on over 1 billion sentence pairs to put similar sentences close together (semantic search / similarity) |
| Small and fast | 6 layers, ~22 M parameters, ~90 MB file. Embedding a resume takes milliseconds on a laptop CPU, with no GPU |
| 384 dimensions | Small vectors: 1.5 KB each, fast to compare, fits pgvector's HNSW limits easily |
| Local, free, private | Resumes are personal data. Nothing is sent to an external API, there are no API keys or costs, and it works offline once downloaded |
| Reproducible | The same text always gives the same vector (unit test "is deterministic") |

The model is loaded **once per server process** and cached on `globalThis` (`getExtractor()`). The first
call downloads it from the Hugging Face Hub into `.cache/transformers/` (gitignored); after that it loads from
disk in about a second. If loading fails, the cached promise is cleared so the next request tries again.

Every embedding row stores `model_name`. If we ever switch models, `npm run db:embed` treats rows with a
different model name as stale and re-embeds them, so vectors from two models are never compared.

## 4. Chunking (and its limits)

The model reads at most **256 word pieces** (tokens) at a time, which is the sentence-transformers limit for
this model. Two are used by the special `[CLS]`/`[SEP]` tokens, so each chunk holds up to **254 tokens**.

1. Split the text into words, count each word's tokens with the model's own tokenizer.
2. Fill a chunk word by word; when the next word would not fit, close the chunk. Words are never cut in half.
3. The next chunk starts with the last ~**32 tokens** of the previous one (overlap), so a sentence cut at a
   border is seen whole by one of the two chunks.
4. Embed each chunk: average of its token vectors (mean pooling), then L2-normalised.
5. Combine the chunks: **weighted mean** (weight = tokens in the chunk, so a short tail chunk counts less),
   then **L2-normalise** again so the stored vector has length 1.

All 12 seeded resumes and 8 jobs fit in one chunk (`chunk_count = 1`). The unit test with ~840 words produced
several chunks.

**Limits (honest):**
- **Averaging blurs.** A resume with one strong ML paragraph and three pages of unrelated retail work gets a
  vector in between. Per-chunk vectors with "best chunk wins" scoring would fix this, at the cost of more rows.
- **Cap of 40 chunks (~10,000 tokens).** Text beyond that is not embedded (`truncated: true` from
  `chunkWords`). Real resumes are far shorter; this only stops a 5 MB text file from taking minutes.
- **A single "word" over 254 tokens** (e.g. a pasted base64 blob) becomes its own chunk and is truncated by the tokenizer.
- **English-centric model.** Resumes in other languages will match poorly.
- The model was trained mostly on sentences of up to 128 tokens, so quality slowly drops for long chunks.

## 5. How vectors are stored

Same database, same transactions, real foreign keys (migration 007):

```
resume_embeddings(resume_id PK/FK → resumes ON DELETE CASCADE, embedding vector(384), model_name,
                  chunk_count, source_hash, created_at)
job_embeddings   (job_id    PK/FK → jobs    ON DELETE CASCADE, embedding vector(384), model_name,
                  chunk_count, source_hash, created_at)
```

| Column / constraint | Purpose |
|---|---|
| `embedding vector(384)` | pgvector column type. The dimension is enforced: a 383-number vector is rejected |
| PK = FK, `ON DELETE CASCADE` | One embedding per resume/job (1 : 0..1). Deleting a resume or job deletes its vector automatically (integration test M8/U1) |
| CHECK `abs(vector_norm(embedding) - 1) < 0.001` | The database refuses vectors that are not unit length, so cosine maths stays valid even if app code had a bug |
| `model_name` | Which model made the vector |
| `source_hash` (SHA-256, CHECK `^[0-9a-f]{64}$`) | Hash of the exact text embedded. If the text changes (e.g. a job is edited), the hash no longer matches and `db:embed` re-embeds it |
| `chunk_count` (CHECK ≥ 1) | How many chunks were averaged |
| HNSW index `USING hnsw (embedding vector_cosine_ops)` on both tables | Approximate nearest-neighbour index for `ORDER BY embedding <=> $1` |

**"Not embedded"** simply means there is no row in the embeddings table (`LEFT JOIN … IS NULL`). No status
column is needed, and it cannot get out of sync. `GET /api/candidate/resumes` returns `isEmbedded` for each resume.

### Failure handling on upload
The upload transaction (insert the resume, maybe make it primary) **commits first**. Embedding runs after
that, outside the transaction, through `tryEmbedResume`, which catches any error. If the model is missing or
crashes, the candidate still gets `201` with `isEmbedded: false`, and the next `npm run db:embed` fills it in.
We deliberately do **not** put the embedding in the same transaction: a model failure must not throw away a
valid upload, and a transaction should not stay open (holding locks) while a neural network runs.

### `npm run db:embed`
Finds every resume and job with no embedding, a different `model_name`, or a `source_hash` that no longer
matches its text, and embeds those. Upserts use `INSERT … ON CONFLICT (pk) DO UPDATE`. First run: 12
resumes + 8 jobs embedded in 2.0 s. Second run: 0 embedded, 0.1 s (idempotent, and it doesn't even load the model).

## 6. Similarity metric: cosine

`similarity = 1 - (a <=> b)`, where `<=>` is pgvector's **cosine distance** (`1 − cos θ`).

- Cosine compares **direction, not length**. A long, detailed resume and a short job post can still point the
  same way. Euclidean distance would punish the length difference.
- The model was trained with cosine similarity, so cosine is the metric its vectors are meant for.
- Our vectors are normalised, so cosine similarity equals the dot product. With unit vectors, cosine, dot
  product and Euclidean distance all give the **same ranking**. We use cosine because its score is easy to
  read (1 = same meaning) and matches `applications.match_score` (NUMERIC(5,4), CHECK −1..1).

Scores are rounded to 4 decimals (the precision of `match_score`), but ordering uses the **unrounded** distance.

Typical values with this model: same-field fits score about **0.6–0.8**, unrelated fields about **0.15–0.3**.
These scores only mean something **relative to each other**; 0.5 is not "50 % qualified".

## 7. How results are retrieved: `rank_candidates_for_job()`

```sql
SELECT * FROM rank_candidates_for_job(p_job_id, p_limit DEFAULT 10, p_applicants_only DEFAULT FALSE);
-- → candidate_id, full_name, years_experience, resume_id, similarity,
--   matched_skills, required_skills, has_applied
```

1. Validates input: limit must be 1–100; the job must exist; the job must have an embedding (otherwise
   `no_data_found` with hint *Run npm run db:embed*).
2. Reads the job vector once into a variable, so the main query compares against a constant (the form an index can use).
3. **Nearest primary resumes** of active users, optionally only applicants (`EXISTS` on `applications`),
   `ORDER BY re.embedding <=> v_job_vector LIMIT p_limit`.
4. Adds name and experience, plus `matched_skills`: the job's **required** skills that the candidate lists
   **at or above** `min_proficiency` (the same rule as Q19 in `important_queries.sql`).

API: `GET /api/recruiter/jobs/:jobId/matches?applicantsOnly=true|false&limit=1..50`
- `withAuth({ roles: [recruiter] })` → 401 without a session, 403 for candidates and admins.
- The job's `company_id` and the recruiter's `company_id` are both loaded **from the database**; different → 403.
- zod (`jobMatchesQuerySchema`, strict): bad or unknown parameters → 400. Malformed or unknown job id → 404.
  Job without an embedding → 404 `NOT_EMBEDDED` with a clear message.

### Real results (seeded data)

**Machine Learning Engineer**: ML/data people first, frontend-only people last:
```
 1. Aditi Sharma        0.7819  skills 3/3  (applied)     7. Ananya Gupta        0.3530  skills 0/3
 2. Rohan Verma         0.6658  skills 1/3  (applied)     8. Neha Bhatt          0.3395  skills 0/3
 3. Divya Krishnan      0.5032  skills 3/3  (applied)     9. Farhan Qureshi      0.3117  skills 0/3
 4. Ishita Banerjee     0.4378  skills 0/3               10. Vikram Chauhan      0.2748  skills 0/3
 5. Aman Malhotra       0.4241  skills 0/3  (applied)    11. Karthik Subramanian 0.2627  skills 0/3
 6. Siddharth Pillai    0.3751  skills 0/3               12. Sneha Kulkarni      0.2438  skills 0/3
```
**Frontend Developer (React / Next.js)**: reversed:
```
 1. Sneha Kulkarni      0.7552  skills 3/3  (applied)     7. Karthik Subramanian 0.3251  skills 0/3
 2. Vikram Chauhan      0.7460  skills 2/3  (applied)     8. Aditi Sharma        0.2619  skills 0/3
 3. Aman Malhotra       0.6429  skills 2/3  (applied)     9. Ishita Banerjee     0.2226  skills 0/3
 4. Ananya Gupta        0.5354  skills 0/3               10. Rohan Verma         0.2169  skills 0/3
 5. Siddharth Pillai    0.3881  skills 0/3               11. Divya Krishnan      0.1848  skills 0/3
 6. Neha Bhatt          0.3553  skills 0/3               12. Farhan Qureshi      0.1582  skills 0/3
```
Worth pointing out in the demo: **Rohan** (data scientist) is #2 for the ML job with only 1/3 skills at the
required level. His resume talks about deep learning and forecasting in TensorFlow, which the vector picks up
but a strict PyTorch/NLP skill filter would miss. That is the point of combining both signals.

## 8. Is the HNSW index used? (EXPLAIN ANALYZE)

**A. The function's core query, default settings:**
```
Limit (actual time=0.645..0.666 rows=10)
  InitPlan 1 -> Index Scan using job_embeddings_pkey on job_embeddings  (job_id = 3)
  -> Sort  Sort Key: ((re.embedding <=> (InitPlan 1).col1))   Sort Method: quicksort
       -> Hash Join … -> Seq Scan on resume_embeddings re (rows=12) …
Execution Time: 1.021 ms
```
**B. Pure k-NN, default settings:** `Seq Scan on resume_embeddings` + `top-N heapsort`, 0.13 ms.

**C. Same k-NN with `SET LOCAL enable_seqscan = off`:**
```
Limit (actual time=1.126..1.137 rows=5)
  -> Index Scan using resume_embeddings_embedding_hnsw_idx on resume_embeddings
       Order By: (embedding <=> (InitPlan 1).col1)
Execution Time: 1.169 ms
```
Top 5 from the index scan: `1,2,11,7,12`. From the sequential scan: `1,2,11,7,12` (identical).

**In simple words:** the index exists and works (plan C), but with only **12 resumes** (one 15-page table)
PostgreSQL's planner correctly decides it is cheaper to read all 12 vectors, compute 12 distances and sort
them than to walk the HNSW graph. Plan B took 0.13 ms; the index took 1.17 ms. A sequential scan is also
**exact**: it really compares the job with every resume. HNSW is *approximate*: on a big table it could, very
rarely, miss a true neighbour in exchange for speed. As the table grows to thousands of resumes, the
sequential scan's cost grows linearly while the HNSW cost grows roughly logarithmically, and the planner will
switch to the index by itself. No query change is needed, because the query already has the indexable shape
`ORDER BY embedding <=> constant LIMIT k`.

Two notes for large data:
- In plan A the vector sort sits **above joins and filters** (`is_primary`, `is_active`, applicants). With the
  index, pgvector filters *after* finding neighbours, so a strict filter can return fewer than `k` rows.
  pgvector 0.8 has `SET hnsw.iterative_scan = relaxed_order` to keep searching until enough rows pass the filter.
- `hnsw.ef_search` (default 40) trades recall for speed at query time.

## 9. Why SQL + pgvector in one database (instead of a separate vector DB)

| | One PostgreSQL with pgvector (our choice) | PostgreSQL + separate vector DB (e.g. Pinecone, Qdrant) |
|---|---|---|
| Ranking with filters | One SQL query joins vectors with `resumes.is_primary`, `users.is_active`, `applications`, `job_skills` | Fetch IDs from the vector DB, then look them up in Postgres, then filter in app code |
| Integrity | Real FK + `ON DELETE CASCADE`. A vector can never point at a deleted resume | Deletes must be synchronised by hand; orphans and ghosts are possible |
| Validation | CHECK constraints on dimension and unit length | Whatever the vector DB offers |
| Security | Same role-checked API and DB credentials | A second service, second set of keys, second attack surface |
| Operations | One Docker container, one backup | Two systems to run, back up and keep consistent |
| Scale | Fine to millions of vectors with HNSW | Built for billions |

For a recruitment system with thousands, not billions, of resumes, keeping vectors next to the relational data
they describe is simpler, safer and fully consistent. The nature of the data decides this: every vector
**belongs to** exactly one resume or job row, so it should live under that row's foreign key.

## 10. Not done yet / next steps

- **Recruiter job create/update routes don't exist yet** (recruiter module). `embedJob(jobId)` /
  `tryEmbedJob(jobId)` in `src/lib/vector-store.js` is the hook those routes must call after saving.
  Until then, edited jobs are re-embedded by `npm run db:embed` (stale hash).
- **`applications.match_score` is still NULL.** The function computes scores on demand; storing them on
  applications at apply time is part of the "apply to job" feature.
- No recruiter UI page for matches yet (API only).
- Ranking candidates → jobs exists only as a SQL query (Q22), not as a function or API.
