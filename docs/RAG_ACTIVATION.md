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

### Caveat: what full-text chunks change for live Ask ATOM

Ingesting chunks flips `ragFunctional` to true (it is a COUNT over
`ans_knowledge_chunks`), which switches the ATOM prompt from the
"METADATA ONLY" disclaimer to the citable "Active Sources" block. Note that the
live `/api/ask-atom` path today ranks **source metadata**
(title/abstract/key_claims via `api/_knowledgeRetrieval.ts`) — it does not yet
inject chunk passages; only Admin → Retrieval Test ranks chunk `content`.
So after ingestion ATOM is permitted to cite those sources, but its grounding
text is still source-level. Wiring chunk passages into the ATOM prompt is a
separate change.

### Never ingested into general RAG

Patient documents — including the **Pare Colombo consultation letter** and any
`.ans`/vendor report — must **never** be added as general knowledge sources.
They are patient PHI, not curated evidence. The reindex/upload paths operate
only on curated `ans_knowledge_sources` rows; patient parsing is a separate
pipeline (`/api/parse`, `/api/upload`, `/api/upload-vendor`).
