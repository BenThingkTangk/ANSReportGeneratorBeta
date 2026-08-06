# HumanOS ANS — RAG pipeline repair + PhysioPS output-protocol enforcement

**Handoff date:** 2026-08-06
**Production app (untouched):** https://humanos-ans-diagnostic.vercel.app/#/
**Upstream repo:** https://github.com/BenThingkTangk/ANSReportGeneratorBeta

Nothing was deployed. No production service, database, or environment variable was modified. The migration in this change was **written but not executed**.

---

## 1. Local project path, branch, commit

| Item | Value |
| --- | --- |
| Local path | `/home/user/workspace/ans-repo` |
| Branch | `fix/rag-repair-terminology-guard` |
| Commit | `bbebf826b0079d0b6cdaa332b781773bd9b7c96b` |
| Base commit | `1c9d778` — `fix(rag): repair retrieval schema, add embedding pipeline + lexical fallback` |
| Pushed? | **No.** `git push` failed with `could not read Username for 'https://github.com': terminal prompts disabled` — no git credential is present in this environment, so per instructions nothing was pushed. `main` was never touched. |

Diff size: 19 files changed, 2203 insertions, 63 deletions.

### What was already in the repo before this work

Important context so nothing is double-counted: the HEAD commit `1c9d778` already contained a first pass at the RAG repair — `supabase/migrations/0006_rag_embeddings_and_match_repair.sql`, `api/_ans/embeddings.ts` (Perplexity `pplx-embed-v1-0.6b`, 1024 dims), `api/_ans/hybridRetrieval.ts`, `api/admin/knowledge/embed-backfill.ts`, `api/_ans/__tests__/ragEmbeddingPipeline.spec.ts`, and `docs/RAG_ACTIVATION.md`. **This commit extends and hardens that work**; it does not duplicate it.

---

## 2. Files changed

### New

| File | Purpose |
| --- | --- |
| `api/_ans/dbConfig.ts` | Single source of truth for the Supabase/Postgres connection contract. Env var **names** only, runtime project-ref parsing, `resolveDbConfig()`, `isDbConfigured()`, `DbConfigError` (status + kind + remediation + required env var names), `describeDbError()` failure classification, `configReport()` diagnostics. Never returns or logs a secret value. |
| `shared/physiopsTerminology.ts` | Authorized PhysioPS output protocol as code. Banned list, ordered detection/relabel rules, `findBannedHrvTerms()`, `isPatientSafeTerminology()`, `sanitizePatientTerminology()`, `assertPatientSafeTerminology()`, patient/clinician prompt blocks. Placed in `shared/` so the server gate and the client renderer use the *same* authority. |
| `supabase/migrations/0007_rag_lexical_fallback_and_embedding_freshness.sql` | **Not executed.** Full-text fallback function, indexes, embedding-freshness trigger, health view. See §4. |
| `api/_ans/__tests__/dbConfigSafeFailure.spec.ts` | 20 tests |
| `api/_ans/__tests__/physiopsTerminology.spec.ts` | 28 tests |
| `api/_ans/__tests__/retrievalGatingAndFallback.spec.ts` | 28 tests |
| `client/src/__tests__/patientTerminologyProtocol.spec.tsx` | 9 tests |

### Modified

| File | Change |
| --- | --- |
| `api/_supabase.ts` | `createSupabaseAdmin()` resolves through `resolveDbConfig()` and throws `DbConfigError` (memoised per URL, invalidated when the env changes). New `tryCreateSupabaseAdmin()` returns `null` instead of throwing, for read-only paths. `handleError()` emits `DbConfigError.toJSON()` (503, actionable, secret-free). |
| `api/ask-atom.ts` | Retrieval now receives `tryCreateSupabaseAdmin()` so a missing/dead database no longer 500s the answer. New exported `sanitizePatientAnswer()`. `buildEventMeanTable(phaseEvents, viewerRole)` omits the `HRV(RMSSD)` column in patient view. System prompt injects the mode-specific terminology rule. Streaming patient path sanitizes with a trailing-token holdback; non-streaming path sanitizes and then **hard-fails (500)** if a banned parameter survives. `report_only` grounding gained `databaseConfigured` plus an explicit "unavailable" note. Clinician mode untouched. |
| `api/_ans/hybridRetrieval.ts` | `RetrievalMode` is now `vector \| fulltext \| lexical \| unavailable`. New `tryFullText()` calls `match_ans_knowledge_chunks_lexical`. New exported `dedupePassages()` and `isGatedApprovedActive()`. `retrieveCandidates(admin: SupabaseLike \| null \| undefined, …)` returns `mode: "unavailable"` with a reason when there is no client. Every tier passes through `finalize()` = gate → dedupe. |
| `api/health.ts` | Adds `config: configReport()` — presence/problems only, no values. |
| `api/upload.ts` | Patient wellness-driver labels and the immune organ-system description reworded out of HRV-parameter language. **Thresholds, weights, and scores are byte-for-byte unchanged.** |
| `client/src/components/AskAtom.tsx` | Patient-mode answers are rendered *and spoken* through `sanitizePatientTerminology()` as a client-side backstop against a stale/cached deployment. Clinician mode unchanged. |
| `client/src/components/AutonomicBalanceGaugeFixed.tsx` | New `audience?: "patient" \| "clinician"` prop, default `"patient"` (fail-safe). Patient view omits the `abg-rmssd` and `abg-sdnn` readouts entirely and labels the balance readout `SB · LFa/RFa`; clinician view is unchanged (`HRV · RMSSD`, `SDNN`, `LF / HF`). |
| `client/src/components/PatientPortalTwoColumn.tsx` | Passes `audience="patient"` explicitly. |
| `client/src/components/patient/AutonomicBalanceGauge.tsx`, `client/src/components/patient/PatientPortal.tsx` | Same gate applied to the legacy (currently unreferenced) gauge/portal pair so no future import can reintroduce the leak. |
| `qa/e2e-verify.mjs` | Patient-view assertion updated: asserts the balance readout renders **and** that `abg-sdnn` is absent in the patient portal. (Playwright script; not part of `npm run ci`.) |
| `.env.example` | Documents how to re-point the deployment at a new project; names only, no values. |

---

## 3. What each required repair maps to

**Database/project configuration easy to update, fails clearly.** The project ref is parsed from `SUPABASE_URL` at runtime in `api/_ans/dbConfig.ts` and is hard-coded nowhere in the runtime path — re-pointing is two env vars (plus the `VITE_` pair) and a redeploy. `describeDbError()` classifies: `not_configured`, `project_not_found` (the observed `{"message":"Project not found"}` for `xsjwubnmcivsskumvgyy`), `unauthorized`, `unreachable`, `missing_relation` (42P01), `missing_column` (42703 — the `s.status` / `s.is_active` / `s.citation` defect, whose remediation text names the real columns `review_status` and `active_in_ai_analysis`), `missing_function` (42883 / PGRST202). Each returns a concrete remediation string. `GET /api/health` now reports `config.database` and `config.ai`.

**Broken `match_ans_knowledge_chunks`.** Repaired by migration `0006` (pre-existing, at base commit) and pinned by tests asserting the SQL filters on `review_status = 'approved'` / `active_in_ai_analysis = true` and never references `s.status`, `s.is_active`, or `s.citation`. Migration `0007` applies the identical gating to the new full-text function.

**Server-side embedding generation and backfill.** Uses the provider already configured in the repo (Perplexity, `PPLX_API_KEY`) via `api/_ans/embeddings.ts`; the key is read server-side only and never reaches the client bundle. Backfill: `POST /api/admin/knowledge/embed-backfill` (admin-cookie protected; `GET` is a status probe). **No embeddings were fabricated** — with no provider key the vector tier simply reports "embedding provider not configured" and retrieval falls through.

**Robust lexical/full-text fallback.** Four tiers, each degrading without throwing and recording *why* in `fallbackReason`: pgvector → Postgres `websearch_to_tsquery` + `ts_rank_cd` (needs **no** AI provider) → in-process deterministic term-overlap ranker (needs only rows) → `unavailable` (report-only grounding). All 16 chunks currently having `embedding IS NULL` therefore still produces grounded answers.

**Approved + active only, no duplicate weighting, provenance.** `isGatedApprovedActive()` drops any row that cannot *prove* `review_status === "approved" && active_in_ai_analysis === true` (including rows with an absent source join), enforced in-process on every tier so SQL drift cannot silently widen the corpus. `dedupePassages()` collapses on chunk id, then `source_id` + whitespace/case-normalised content — while deliberately **keeping** identical text from *different* sources, which is independent evidence. Provenance (`title`, `authors`, `year`, `publication_type`, `url`, `source_id`) flows through every tier; citations are composed from those columns and never invented.

**PhysioPS output protocol.** Banned in patient-facing output: `ULF`, `VLF`, `LF`, `HF`, `TSP`, `sdNN`, `rmsSD`, `pNN50`. Enforced at four layers: the system prompt, the patient prompt table (RMSSD column omitted), the server output gate (`sanitizePatientAnswer()` on stream and non-stream, with a 500 backstop), and the client renderer/TTS. Clinician views retain instrument-derived metrics for exact vendor parity.

Two deliberate clinical-safety decisions worth reviewing:
1. **An RMSSD or SDNN value is never relabelled as `RFa` / `LFa`.** They are different quantities; renaming would fabricate clinical meaning. In patient view those readouts are **omitted**, not renamed.
2. **The gauge's "LF / HF" readout is relabelled, not omitted,** because the value passed to it is `baselinePhase.SB` = LFa/RFa — it was already the P&S sympathovagal balance and was merely mislabelled. `SB · LFa/RFa` is factually exact.

The sanitizer never fabricates a number, a reference range, or a diagnosis; it relabels a parameter name into P&S wording and strips a value that was attached to a banned parameter. Tested for idempotence, markdown-structure preservation, and — critically — **no false positives**: `LFa`, `RFa`, `sympathovagal balance`, and ordinary English words such as "half" and "self" pass through untouched.

**Preservation.** No change to `.ans` parsing, deterministic scoring, thresholds, phenotype logic, vendor reconciliation, or report generation. The `eval:ci` clinical regression gate passes 15/15 with 0 unsafe overclaims.

---

## 4. Exact database migration (NOT executed)

File: `supabase/migrations/0007_rag_lexical_fallback_and_embedding_freshness.sql` (270 lines). Additive and idempotent; contains no `DROP TABLE`, `TRUNCATE`, or `DELETE FROM`. Apply **after** `0001`–`0006`.

Contents:

1. `ALTER TABLE public.ans_knowledge_chunks` — add generated column `content_tsv tsvector` (`to_tsvector('english', content)`), guarded on the column not already existing.
2. `CREATE INDEX IF NOT EXISTS ans_knowledge_chunks_content_tsv_gin` — `USING gin (content_tsv)`.
3. Optional trigram index `ans_knowledge_chunks_content_trgm`, created only if `pg_trgm` is available.
4. `CREATE INDEX IF NOT EXISTS ans_knowledge_sources_approved_active` (gating) and `ans_knowledge_chunks_source_id` (join).
5. `CREATE OR REPLACE FUNCTION public.match_ans_knowledge_chunks_lexical(query_text text, match_count int DEFAULT 12)` — `LANGUAGE sql STABLE SECURITY INVOKER`, `SET search_path = public, pg_catalog`. Returns `(id uuid, source_id uuid, chunk_index int, content text, citation text, title text, authors text, year int, publication_type text, url text, similarity double precision)` — the same output contract as `match_ans_knowledge_chunks`. Uses `websearch_to_tsquery('english', …)` + `ts_rank_cd`, gates on `s.review_status = 'approved' AND s.active_in_ai_analysis = true`, de-duplicates with `DISTINCT ON (c.source_id, md5(lower(regexp_replace(content, '\s+', ' ', 'g'))))`, composes `citation` from `concat_ws(', ', title, authors, year, publication_type)`, and clamps `LIMIT greatest(1, least(coalesce(match_count, 12), 100))`.
6. `public.ans_knowledge_chunks_invalidate_embedding()` + trigger `trg_ans_knowledge_chunks_invalidate_embedding` — sets `embedding = NULL` when `content` changes, so a stale vector can never outlive its text. Created only if the `embedding` column exists (i.e. pgvector present and `0006` applied).
7. `CREATE OR REPLACE VIEW public.ans_rag_health` — operator counts of sources/chunks/embedded/unembedded.
8. `GRANT EXECUTE ON FUNCTION public.match_ans_knowledge_chunks_lexical(text, int) TO service_role;` and `GRANT SELECT ON public.ans_rag_health TO service_role;`

Post-apply verification steps are written as comments at the end of the file.

---

## 5. Environment variables (names only — no values anywhere in the repo or this document)

**Server-only, required for the database:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Browser bundle (anon key only, safe to expose):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Server-only, AI / embeddings:**
- `PPLX_API_KEY`
- `EMBEDDING_MODEL` *(optional)*
- `EMBEDDING_DIMENSIONS` *(optional — must match the DB `vector(N)` column and every stored vector; changing it requires a migration)*

**Pre-existing, unchanged:** `ELEVENLABS_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `ADMIN_SESSION_TTL_SEC`, `ADMIN_GATEWAY_MAX_ATTEMPTS`, `ADMIN_GATEWAY_WINDOW_SEC`, `ADMIN_GATEWAY_LOCKOUT_SEC`.

`SUPABASE_SERVICE_ROLE_KEY` and `PPLX_API_KEY` must never be exposed as `VITE_` variables — asserted by a test.

---

## 6. Test / build results

All commands run in `/home/user/workspace/ans-repo` at commit `bbebf82`.

| Command | Result |
| --- | --- |
| `npm run audit:esm` | pass — all relative runtime imports use explicit `.js` extensions |
| `npx tsc --noEmit` | pass — clean |
| `npm run test:ans` | **56 files, 598 passed, 12 skipped** (baseline before this work: 53 files, 522 passed, 12 skipped → **+76** tests, no regressions) |
| `npm run test:client` | **22 files, 106 passed** (baseline: 21 files, 97 passed → **+9**) |
| `npm run eval:ci` | **15/15 cases passed**; demographics 13/13, numeric 25/25, missing-detection 9/9, flag P/R/F1 = 1.000/1.000/1.000, **0 unsafe overclaims**; regression gate PASSED |
| `npm run build` | pass — vite client bundle + esbuild server `dist/index.cjs` |

**There is no lint script in this repo.** `package.json` provides `check` (`tsc`), `test:ans`, `test:client`, `eval:ci`, `audit:esm`, and the aggregate `ci` (`audit:esm && tsc --noEmit && test:ans && test:client && eval:ci`) — all of which pass. No ESLint/Biome/Prettier configuration exists to run.

Two genuine defects in my own first draft were caught by the new tests and fixed before commit: (a) `"ultra low-frequency band"` was double-attributed to both `ULF` and `LF`, fixed by applying detection rules in order with masking so each occurrence is attributed once to the most specific rule; (b) the spectral-unit regex had a trailing `\b` that could never match `ms²`, since `²` is not a word character.

---

## 7. Remaining blockers

1. **No live database.** `SUPABASE_URL` still points at a dead project ref (`xsjwubnmcivsskumvgyy` → "Project not found"). Until a live project exists, ATOM answers are grounded in the report only. This is now *reported* rather than silent, but it is still a blocker for knowledge retrieval. Required: create/restore a project → apply `supabase/migrations/0001`–`0007` in order → set the four Supabase env vars → redeploy.
2. **Migration 0007 is not executed** (by instruction). The full-text tier reports `match_ans_knowledge_chunks_lexical unavailable (apply migration 0007)` and falls through to the in-process lexical ranker until it is applied.
3. **All chunk embeddings are still `NULL`.** After the DB is live and `PPLX_API_KEY` is set, run `POST /api/admin/knowledge/embed-backfill` to populate them; the vector tier then activates automatically with no code change. No embeddings were fabricated.
4. **Not pushed.** No git credential is available in this environment. To publish: push `fix/rag-repair-terminology-guard` and open a PR against `main`. Never push to `main`.
5. **Unverified against a live browser.** `qa/e2e-verify.mjs` and `npm run qa:visual` require a running deployment and were not executed here; the patient-gauge protocol change is covered by jsdom tests only. Worth one manual pass of the patient portal and ATOM patient mode after deploy.
6. **Duplicated gauge components.** `client/src/components/AutonomicBalanceGaugeFixed.tsx` and `client/src/components/patient/AutonomicBalanceGauge.tsx` are near-duplicates (the latter is currently unreferenced). Both were gated, but they should be consolidated to remove the drift risk. Out of scope for this change.
7. **Clinician-surface audit was scoped, not exhaustive.** Patient-facing surfaces were swept for banned terms; clinician surfaces (e.g. `client/src/lib/colomboAnalogies.ts`, `components/clinician/ColomboExplainer.tsx`, the numerical summary) intentionally retain instrument terminology for vendor parity. If any of those components is ever rendered inside a patient route, it would need the same `audience` gate.

---

## 8. Suggested review order

1. `api/_ans/dbConfig.ts` — the configuration contract.
2. `shared/physiopsTerminology.ts` — the protocol rules, especially the `LFa`/`RFa` protection lookaheads.
3. `api/ask-atom.ts` — the patient-mode gate (prompt, table, stream, non-stream backstop).
4. `api/_ans/hybridRetrieval.ts` — `finalize()`, `isGatedApprovedActive()`, `dedupePassages()`, tier order.
5. `supabase/migrations/0007_*.sql` — before applying to a live project.
6. `api/upload.ts` diff — confirm only wording changed, never a threshold.
