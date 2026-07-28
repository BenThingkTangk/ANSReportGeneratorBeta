# Activating the knowledge-base RAG (13 sources → chunks)

## Why the recording showed "13 sources / 0 chunks"

`supabase/migrations/0002_seed_admins_and_sources.sql` seeds **13**
`ans_knowledge_sources` rows (each with a rich `abstract` + `key_claims`) via
plain SQL. No file was ever uploaded for them, and the only code path that wrote
`ans_knowledge_chunks` was the file-upload handler — so the corpus had **0
chunks** and retrieval returned nothing. `parser-health` now reports this
honestly (`ragFunctional=false`, `ragStatus="sources_present_no_chunks"`).

## What this branch changed

1. **`supabase/migrations/0005_rag_chunk_metadata.sql`** — PURE, idempotent,
   additive DDL: adds the nullable `page`/`section` columns to
   `ans_knowledge_chunks`. It ingests NO content and modifies no existing rows,
   so it does not by itself make RAG "functional" — it only unlocks page/section
   citations. Chunks are created on demand by the endpoints below.
2. **`POST /api/admin/knowledge/reindex`** — idempotent application-level
   creation of **metadata placeholder chunks** (title + abstract + key_claims)
   for approved+active sources, explicitly returned as `ragFunctional:false`
   (metadata ≠ full-text RAG). Body: `{ sourceIds?, onlyMissing?, activeApprovedOnly? }`.
3. **`api/admin/knowledge/upload.ts`** — now extracts PDF text via the hardened
   `extractPdfText` with an **OCR fallback** for image-only PDFs, and surfaces an
   explicit `ingestionError` instead of silently producing 0 chunks.
4. **`api/admin/retrieval-test.ts`** — shares the scoring with the live path and
   now returns a `citation` (title + year + page/section) per hit.
5. **`api/admin/parser-health.ts`** — `ragFunctional` / `ragStatus` /
   `totalChunks` / `metadataOnlyChunks` / `fullTextChunks` / `chunkSchemaVersion`.

## Schema compatibility — migration 0005 is OPTIONAL and auto-detected

**Do not assume migration 0005 has been applied.** A deployed database may still
be on the legacy `ans_knowledge_chunks` schema (`id, source_id, chunk_index,
content, tokens, created_at`). Selecting the migration-0005 columns (`page`,
`section`) on that schema makes PostgREST return `42703` ("column ... does not
exist") and previously crashed the Retrieval Test.

`api/_ans/knowledgeSchema.ts` now **probes the live schema at runtime** (cached)
and every consumer adapts:
- **Retrieval Test** selects `page`/`section` only when they exist; otherwise it
  falls back to a chunk-index locator in the citation (e.g. `Title (2019), chunk 0`).
- **Parser & Model Health** reports `chunkSchemaVersion` (`0001` legacy / `0005`
  / `partial`) and counts metadata vs full-text chunks.
- **Reindex / Upload** write the `section` marker only when the column exists.

`GET /api/admin/knowledge/schema-status` reports the detected schema and, when
legacy, returns the **exact SQL** to add the optional columns. That endpoint
**does not and cannot apply DDL** (the Supabase JS client has no DDL surface),
so it never claims a migration was applied. To enable page-accurate citations,
run this in the Supabase SQL editor (or apply `0005`):

```sql
ALTER TABLE public.ans_knowledge_chunks
  ADD COLUMN IF NOT EXISTS page    int,
  ADD COLUMN IF NOT EXISTS section text;
```

Retrieval is fully functional **without** these columns — they only add
page/section citation precision.

## To activate the REAL 13-source RAG in a deployed environment

Migration 0005 adds only the citation columns — it does NOT create chunks, so a
freshly-migrated DB still has `totalChunks = 0` and `ragFunctional:false` until
content is ingested. Three ingestion paths (none invents content):

1. **Metadata placeholders** (searchable, but NOT full-text RAG): call
   `POST /api/admin/knowledge/reindex`. This chunks each approved source's
   existing title/abstract/key_claims and returns `ragFunctional:false` with a
   note; health reports `ragStatus:"metadata_only"`.
2. **Full-text depth** (the real activation): in Admin → **Upload PDF**, upload
   each of the 13 approved sources' actual documents (DePace/Colombo book
   chapters, the Colombo P&S consultation/transcript, the dysautonomia reviews
   listed in `ans_knowledge_sources`). These files are **not in this repo** and
   must be supplied by an admin. Each upload chunks into `ans_knowledge_chunks`
   with `section='document'`.
3. **Pre-curated full-text chunks** (passages curated outside the app — e.g. a
   consultation transcript already split into sections): call
   `POST /api/admin/knowledge/ingest-chunks` with
   `{ sourceId, chunks: [{ chunk_index, content, section?, page? }] }`.
   Unlike `upload` it needs no binary file and preserves the curator's own chunk
   indices and section titles; unlike `reindex` it writes REAL full text (never
   the reserved `section='metadata'` marker), so health reports `indexed`.
   Idempotent — `replace` defaults to true, so it deletes just that source's
   chunks and rewrites them; re-running yields the same corpus, not duplicates.
   It refuses unknown/unapproved sources, recomputes `tokens` from `content`,
   omits `section`/`page` when the DB lacks migration 0005, and rejects the
   whole batch if any chunk contains patient-identifier patterns. Pass
   `{"dryRun": true}` to validate and write nothing.

   **No embeddings are required.** Retrieval is deterministic lexical
   term-overlap over `content` (`api/admin/retrieval-test.ts`,
   `api/_ans/knowledgeChunking.ts`); the `embedding` column is never read or
   written by any code path, so rows inserted with a NULL embedding are
   immediately retrievable.
4. (Optional) apply `0005` first for page/section-accurate citations; retrieval
   works without it via the fallback locator.
5. Verify in Admin → **Parser & Model Health**: `Knowledge Base (RAG)` should
   read `indexed` with `fullTextChunks > 0`, and Admin → **Retrieval Test**
   should return ranked hits with citations.

### What full-text chunks change for live Ask ATOM

Once chunks exist, `/api/ask-atom` performs **true passage retrieval**:

1. `getCandidatePassages()` (`api/_knowledgeCache.ts`) fetches chunks joined to
   their source, filtered **in SQL** to `active_in_ai_analysis = true` and
   `review_status = 'approved'`, and probes for `page`/`section` so a legacy
   schema cannot 42703 the chat request.
2. `selectPassages()` (`api/_ans/knowledgePassages.ts`) ranks them against the
   user's question with the **same deterministic `scoreChunk()`** the admin
   retrieval test uses, drops `section='metadata'` placeholders, and keeps the
   top passages that clear a relevance floor.
3. `buildPassagePromptSection()` injects those excerpts with
   `Title (Year), page | section | chunk N` citations.

**Grounding honesty is per-answer.** `ragFunctional` requires chunks to exist
*and* at least one passage to be relevant to this question. A corpus that has
chunks but nothing relevant reports `mode:"report_only"` with a note, so ATOM is
not licensed to cite it for that answer.

**Strict separation is enforced.** The passage block is labeled explanatory
context only and appears *before* the patient/vendor blocks, which remain the
last and most proximate authority. The prompt forbids using a passage to supply
or infer a patient value, to change or re-grade any deterministic score or
vendor finding, or to apply a quoted threshold to this patient's numbers.
Passages from transcripts/consultations are marked `[TRANSCRIPT]` and framed as
attributed explanatory speech that may require verification with the treating
clinician. Retrieval never touches deterministic scoring — the rendered patient
context is byte-identical with and without retrieval (asserted in
`api/_ans/__tests__/atomPassageGroundingIntegration.spec.ts`).

### Never ingested into general RAG

Patient documents — including the **Pare Colombo consultation letter** and any
`.ans`/vendor report — must **never** be added as general knowledge sources.
They are patient PHI, not curated evidence. The reindex/upload paths operate
only on curated `ans_knowledge_sources` rows; patient parsing is a separate
pipeline (`/api/parse`, `/api/upload`, `/api/upload-vendor`).

---

# Embedding pipeline + retrieval repair (migration 0006)

## The live defect this fixes

The live project (`xsjwubnmcivsskumvgyy`) had a `public.match_ans_knowledge_chunks`
function created out-of-band that referenced columns which **do not exist** on
`public.ans_knowledge_sources`:

| broken reference | real column |
| --- | --- |
| `s.status` | `s.review_status` |
| `s.is_active` | `s.active_in_ai_analysis` |
| `s.citation` | *(no such column — compose from `title`/`authors`/`year`)* |

Every call therefore failed with `42703` (undefined column). Separately, the 16
existing chunks all had `embedding IS NULL` and there was **no** embedding trigger,
so a vector search could not have returned anything even with a correct function.

Note: no application code ever called that RPC — Ask ATOM was already retrieving
via the deterministic lexical ranker, which is why answers still worked. The
function was dead-but-broken; 0006 makes it correct and the app now uses it when
embeddings exist.

## What was added

1. **`supabase/migrations/0006_rag_embeddings_and_match_repair.sql`** — idempotent,
   additive: enables `vector` (if available), adds `ans_knowledge_chunks.embedding
   vector(1024)`, adds a cosine ANN index + a partial index over NULL embeddings,
   and **replaces** `match_ans_knowledge_chunks` with a version that filters on
   `review_status='approved' AND active_in_ai_analysis=true` and returns a citation
   composed from real metadata. Safe on a database without pgvector (it skips the
   vector-only objects and the app stays lexical). Modifies no rows, seeds no
   content, and touches nothing in the `.ans` parser or any clinical calculation.
2. **`api/_ans/embeddings.ts`** — server-only embedding generation via the
   Perplexity Embeddings API (`POST https://api.perplexity.ai/v1/embeddings`) using
   the existing `PPLX_API_KEY`. Model `pplx-embed-v1-0.6b` → **1024 dims** (kept
   under pgvector's 2000-dim index ceiling). Provider returns **base64 int8,
   unnormalised**, so vectors are decoded and L2-normalised before storage. The key
   is never returned, logged, or shipped to the client.
3. **`POST /api/admin/knowledge/embed-backfill`** (admin-only; `GET` = status probe)
   — batched, resumable backfill of `embedding IS NULL` rows for **approved +
   AI-active** sources only. Writes only the `embedding` column. If the provider is
   unconfigured or failing it changes nothing and says so.
4. **`api/_ans/hybridRetrieval.ts`** — vector-first retrieval with a deterministic
   **lexical fallback**. Any vector-path problem (no column, all-NULL embeddings,
   pgvector/RPC absent, provider unconfigured or erroring, zero matches) falls back
   silently to the existing ranker. `grounding.retrieval` + `retrievalFallbackReason`
   are returned so "RAG" is never claimed more strongly than earned.
5. **HRV output rule** — `buildPassagePromptSection` now carries an explicit rule:
   passages may mention generic HRV indices (SDNN, RMSSD, pNN50, LF/HF, ms² powers)
   internally, but those must **never** be surfaced in HumanOS outputs; answers use
   P&S measures (LFa, RFa, SB) instead.

## Deployment steps (not performed here)

```bash
# 1. Apply the migration to the live project.
supabase db push            # or paste 0006 into the SQL editor

# 2. Verify the function is correct + the column exists.
#    (expects: 0 rows but NO 42703 error)
select * from public.match_ans_knowledge_chunks(array_fill(0::real,array[1024])::vector, 0, 1);

# 3. Backfill embeddings (admin session required). Re-run until remaining = 0.
curl -X POST https://<host>/api/admin/knowledge/embed-backfill \
  -H 'content-type: application/json' -b "$ADMIN_COOKIE" -d '{"limit":32}'

# 4. Confirm status.
curl -s https://<host>/api/admin/knowledge/embed-backfill -b "$ADMIN_COOKIE"
```

## Required env (names only — never commit values)

| Var | Purpose |
| --- | --- |
| `PPLX_API_KEY` | already present; now also used for embeddings |
| `EMBEDDING_MODEL` | *optional* override (default `pplx-embed-v1-0.6b`) |
| `EMBEDDING_DIMENSIONS` | *optional* override (default `1024`) — **must** match the DB `vector(N)` column and all stored vectors |
