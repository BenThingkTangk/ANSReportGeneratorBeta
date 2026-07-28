/**
 * api/_ans/curatedChunks.ts
 *
 * Pure validation + row-building for PRE-CURATED knowledge chunks.
 *
 * Context: the existing ingestion paths cannot accept chunks that were curated
 * outside the app —
 *   • /api/admin/knowledge/upload requires a multipart PDF/text FILE and
 *     re-derives its own chunk boundaries (so a curator's section titles and
 *     chunk indices are lost);
 *   • /api/admin/knowledge/reindex only chunks a source's own METADATA
 *     (title/abstract/key_claims) and marks it section='metadata', which
 *     computeRagStatus() deliberately treats as NOT functional RAG.
 *
 * Retrieval is deterministic lexical term-overlap over `content`
 * (api/_ans/knowledgeChunking.scoreChunk + api/admin/retrieval-test), and the
 * `embedding` column is never read or written by any code path. So chunks with
 * a NULL embedding are fully retrievable — no vectors are required.
 *
 * This module is intentionally pure (no DB, no network) so the validation
 * contract is unit-testable offline. It does NOT touch deterministic scoring.
 */

/** A chunk as produced by an external curation pass. */
export interface CuratedChunkInput {
  chunk_index: number | string;
  content: string;
  /** Optional human-readable locator (e.g. a transcript section title). */
  section?: string | null;
  /** Optional page number for paginated documents. */
  page?: number | string | null;
  /** Optional — recomputed when absent so the stored value always matches content. */
  tokens?: number | string | null;
}

/** A row ready for insertion into ans_knowledge_chunks. */
export interface CuratedChunkRow {
  source_id: string;
  chunk_index: number;
  content: string;
  tokens: number;
  section?: string;
  page?: number;
}

export interface ValidateOptions {
  /** Target source UUID — every row is written under this id. */
  sourceId: string;
  /** Whether the live DB has the migration-0005 `section` column. */
  hasSection: boolean;
  /** Whether the live DB has the migration-0005 `page` column. */
  hasPage: boolean;
}

export interface ValidationResult {
  ok: boolean;
  rows: CuratedChunkRow[];
  errors: string[];
  /** Non-fatal notes (e.g. a dropped column the schema cannot store). */
  warnings: string[];
}

/** Hard caps — a curated batch is small by construction; refuse anything odd. */
export const MAX_CHUNKS = 500;
export const MAX_CONTENT_CHARS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Patterns that must never appear in a KNOWLEDGE chunk. The knowledge corpus is
 * clinical/educational reference material; anything resembling patient
 * identifiers means the wrong file was pointed at this endpoint. We reject the
 * whole batch rather than ingest and try to scrub afterwards.
 *
 * Deliberately narrow so ordinary clinical prose (ages, ratios, "the patient")
 * passes: a bare "patient" is normal teaching language and is NOT an identifier.
 */
const PHI_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b\d{3}-\d{2}-\d{4}\b/, label: "SSN-like number" },
  { re: /\bMRN\s*[:#]?\s*\d+/i, label: "medical record number" },
  { re: /\b(?:DOB|date of birth)\b\s*[:#]?\s*\d/i, label: "date of birth" },
  { re: /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/i, label: "email address" },
  { re: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/, label: "explicit calendar date (possible DOB)" },
];

/** Scan text for patient-identifier patterns. Returns the labels that matched. */
export function scanForPhi(text: string): string[] {
  const hits: string[] = [];
  for (const { re, label } of PHI_PATTERNS) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

/**
 * Validate a curated batch and build insertable rows.
 *
 * Rules:
 *  • sourceId must be a UUID; every chunk's own source_id (if present) must match.
 *  • chunk_index must be a non-negative integer and unique within the batch.
 *  • content must be a non-empty string within the size cap.
 *  • tokens is always recomputed from content (never trusted from the file).
 *  • section/page are only emitted when the live schema has those columns.
 *  • any PHI-looking content fails the WHOLE batch (fail closed).
 */
export function validateCuratedChunks(
  input: unknown,
  opts: ValidateOptions,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!UUID_RE.test(opts.sourceId ?? "")) {
    return { ok: false, rows: [], errors: [`sourceId "${opts.sourceId}" is not a valid UUID`], warnings };
  }
  if (!Array.isArray(input)) {
    return { ok: false, rows: [], errors: ["chunks must be an array"], warnings };
  }
  if (input.length === 0) {
    return { ok: false, rows: [], errors: ["chunks array is empty"], warnings };
  }
  if (input.length > MAX_CHUNKS) {
    return { ok: false, rows: [], errors: [`too many chunks (${input.length} > ${MAX_CHUNKS})`], warnings };
  }

  const rows: CuratedChunkRow[] = [];
  const seenIndices = new Set<number>();
  let droppedSection = 0;
  let droppedPage = 0;

  input.forEach((raw: any, i: number) => {
    const where = `chunk[${i}]`;
    if (!raw || typeof raw !== "object") {
      errors.push(`${where}: not an object`);
      return;
    }
    // A chunk may carry its own source_id; if so it must agree with the target.
    if (raw.source_id != null && String(raw.source_id) !== opts.sourceId) {
      errors.push(`${where}: source_id "${raw.source_id}" does not match target sourceId "${opts.sourceId}"`);
      return;
    }
    const idx = toInt(raw.chunk_index);
    if (idx == null || idx < 0) {
      errors.push(`${where}: chunk_index must be a non-negative integer (got ${JSON.stringify(raw.chunk_index)})`);
      return;
    }
    if (seenIndices.has(idx)) {
      errors.push(`${where}: duplicate chunk_index ${idx}`);
      return;
    }
    const content = typeof raw.content === "string" ? raw.content.trim() : "";
    if (content.length === 0) {
      errors.push(`${where}: content is empty`);
      return;
    }
    if (content.length > MAX_CONTENT_CHARS) {
      errors.push(`${where}: content too long (${content.length} > ${MAX_CONTENT_CHARS} chars)`);
      return;
    }
    const phi = scanForPhi(content);
    if (phi.length > 0) {
      errors.push(`${where}: refusing — content contains ${phi.join(", ")}. Knowledge chunks must carry no patient data.`);
      return;
    }

    seenIndices.add(idx);
    const row: CuratedChunkRow = {
      source_id: opts.sourceId,
      chunk_index: idx,
      content,
      // Always recomputed so the stored token count matches the stored content.
      tokens: Math.ceil(content.length / 4),
    };

    const section = typeof raw.section === "string" ? raw.section.trim() : "";
    if (section) {
      if (opts.hasSection) {
        // NOTE: 'metadata' is a reserved marker meaning "placeholder chunk, not
        // full text" (see api/_ans/ragStatus.ts). Curated chunks are real full
        // text, so that value must never be written here.
        row.section = section.toLowerCase() === "metadata" ? `curated: ${section}` : section;
      } else {
        droppedSection++;
      }
    }
    const page = toInt(raw.page);
    if (page != null) {
      if (opts.hasPage) row.page = page;
      else droppedPage++;
    }
    rows.push(row);
  });

  if (droppedSection > 0) {
    warnings.push(
      `${droppedSection} chunk(s) had a section title but the DB lacks the 'section' column (migration 0005 not applied); ingested without it.`,
    );
  }
  if (droppedPage > 0) {
    warnings.push(
      `${droppedPage} chunk(s) had a page number but the DB lacks the 'page' column (migration 0005 not applied); ingested without it.`,
    );
  }

  // Fail closed: any per-chunk error rejects the batch so we never write a
  // partially-valid corpus.
  if (errors.length > 0) return { ok: false, rows: [], errors, warnings };

  rows.sort((a, b) => a.chunk_index - b.chunk_index);
  return { ok: true, rows, errors, warnings };
}
