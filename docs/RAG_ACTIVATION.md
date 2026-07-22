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
5. **`api/admin/parser-health.ts`** — `ragFunctional` / `ragStatus` / `totalChunks`.

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
