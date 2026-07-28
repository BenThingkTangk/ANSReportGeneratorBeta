/**
 * api/_ans/ragStatus.ts
 *
 * Pure decision for the knowledge-base RAG health status, so the "is RAG
 * actually functional?" logic is unit-testable without a live DB. Retrieval is
 * only functional when FULL-TEXT chunks exist. Zero chunks, or chunks that are
 * all metadata placeholders, are explicitly NOT functional RAG.
 */

export type RagStatus =
  | "empty"
  | "sources_present_no_chunks"
  | "metadata_only"
  | "indexed_mixed"
  | "indexed";

export interface RagStatusInput {
  totalSources: number;
  totalChunks: number;
  /** Count of section='metadata' placeholder chunks, or null when the section
   *  column does not exist (legacy schema — kind is indeterminable). */
  metadataOnlyChunks: number | null;
}

export interface RagStatusResult {
  ragFunctional: boolean;
  ragStatus: RagStatus;
  /** Chunks that are real document text; null when indeterminable (legacy). */
  fullTextChunks: number | null;
  activation?: string;
}

export function computeRagStatus(input: RagStatusInput): RagStatusResult {
  const total = input.totalChunks;
  const fullTextChunks =
    input.metadataOnlyChunks == null ? null : Math.max(0, total - input.metadataOnlyChunks);

  if (total === 0) {
    return {
      ragFunctional: false,
      ragStatus: input.totalSources > 0 ? "sources_present_no_chunks" : "empty",
      fullTextChunks,
      activation:
        input.totalSources > 0
          ? "Sources exist but 0 chunks. Run POST /api/admin/knowledge/reindex (metadata chunks) or upload the source files (full text). See docs/RAG_ACTIVATION.md."
          : "No knowledge sources. Add + approve sources, then ingest.",
    };
  }

  // Chunks exist. If we can PROVE they are all metadata placeholders
  // (fullTextChunks === 0), retrieval works but is NOT full-text RAG. When the
  // section column is absent (fullTextChunks === null) we cannot distinguish;
  // chunks exist so retrieval is functional, flagged as indeterminate kind.
  if (fullTextChunks === 0) {
    return {
      ragFunctional: false,
      ragStatus: "metadata_only",
      fullTextChunks,
      activation:
        "Only metadata placeholder chunks exist (title/abstract/claims). This is NOT full-text RAG. Upload the source documents via Admin → Upload PDF to ingest real passages. See docs/RAG_ACTIVATION.md.",
    };
  }

  return {
    ragFunctional: true,
    ragStatus: input.metadataOnlyChunks && input.metadataOnlyChunks > 0 ? "indexed_mixed" : "indexed",
    fullTextChunks,
  };
}
