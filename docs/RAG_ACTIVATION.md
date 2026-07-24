# Activating the knowledge-base RAG (13 sources → chunks)

## Why the recording showed "13 sources / 0 chunks"

`supabase/migrations/0002_seed_admins_and_sources.sql` seeds **13**
`ans_knowledge_sources` rows (each with a rich `abstract` + `key_claims`) via
plain SQL. No file was ever uploaded for them, and the only code path that wrote
`ans_knowledge_chunks` was the file-upload handler — so the corpus had **0
chunks** and retrieval returned nothing. `parser-health` now reports this
honestly (`ragFunctional=false`, `ragStatus="sources_present_no_chunks"`).

## What this branch changed

1. **`supabase/migrations/0005_backfill_knowledge_chunks.sql`** — adds `page`/
   `section` columns to `ans_knowledge_chunks` and backfills **one metadata
   chunk per approved+active source** (title + abstract + key_claims). Running
   migrations on a fresh DB makes retrieval work immediately with no upload.
2. **`POST /api/admin/knowledge/reindex`** — idempotent application-level
   backfill (same logic) for an already-migrated DB; splits long sources into
   multiple chunks. Body: `{ sourceIds?, onlyMissing?, activeApprovedOnly? }`.
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

The seeded **metadata** (abstract + key_claims) is enough for the migration to
produce a functional, citeable corpus. To ingest the **full source documents**
(deeper passages, page-accurate citations) an admin must re-upload the original
files, which are **not in this repo**:

1. Apply migrations through `0005` (backfills metadata chunks).
2. For full-text depth, in the Admin Console → **Upload PDF**, upload each of the
   13 approved sources' PDFs (the DePace/Colombo book chapters, the Colombo P&S
   consultation/transcript, the dysautonomia review articles listed in
   `ans_knowledge_sources`). Each upload chunks into `ans_knowledge_chunks`.
3. Or call `POST /api/admin/knowledge/reindex` to (re)build metadata chunks for
   every approved source at once.
4. Verify in Admin → **Parser & Model Health**: `Knowledge Base (RAG)` should
   read `indexed` with `totalChunks > 0`, and Admin → **Retrieval Test** should
   return ranked hits with citations.

### Never ingested into general RAG

Patient documents — including the **Pare Colombo consultation letter** and any
`.ans`/vendor report — must **never** be added as general knowledge sources.
They are patient PHI, not curated evidence. The reindex/upload paths operate
only on curated `ans_knowledge_sources` rows; patient parsing is a separate
pipeline (`/api/parse`, `/api/upload`, `/api/upload-vendor`).
