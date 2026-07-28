/**
 * api/_ans/knowledgePassages.ts
 *
 * Pure ranking + prompt formatting for FULL-TEXT knowledge passages injected
 * into the live Ask ATOM prompt.
 *
 * Until now `/api/ask-atom` only ranked source METADATA (title/abstract/
 * key_claims); chunk rows merely flipped a COUNT-based `ragFunctional` gate. So
 * a corpus of real curated passages could be cited but never actually quoted.
 * This module selects the top relevant passages with the SAME deterministic
 * lexical scorer used by the admin retrieval test (`scoreChunk`), so live and
 * admin retrieval agree and every ranking is explainable offline.
 *
 * HARD BOUNDARIES (enforced by the prompt block this builds):
 *   • Passages are EXPLANATORY CONTEXT ONLY. They never supply a patient value,
 *     never change deterministic scoring, and never turn a transcript threshold
 *     into a computed diagnosis.
 *   • Patient-specific facts always come from the report / vendor blocks, which
 *     remain authoritative.
 *   • Transcript/consultation passages are attributed explanatory SPEECH and are
 *     flagged as requiring clinician verification.
 *
 * Pure: no DB, no network, no clock. The caller fetches candidate rows.
 */
import { rankChunks, type RankedChunk } from "./knowledgeChunking.js";

/** A chunk row joined to its source, as fetched from ans_knowledge_chunks. */
export interface PassageRow {
  id?: string;
  source_id?: string;
  chunk_index?: number | null;
  content?: string | null;
  /** Present only on the migration-0005 schema. */
  section?: string | null;
  page?: number | null;
  source?: {
    id?: string;
    title?: string | null;
    authors?: string | null;
    year?: number | null;
    publication_type?: string | null;
    url?: string | null;
    active_in_ai_analysis?: boolean | null;
    review_status?: string | null;
  } | null;
}

export interface SelectedPassage {
  content: string;
  /** Human-readable citation, e.g. `Colombo Consultation (2026), Wellness Score`. */
  citation: string;
  score: number;
  matched: string[];
  /** True when the passage is spoken/transcript material rather than a paper. */
  isTranscript: boolean;
  sourceId: string | null;
}

/**
 * `section='metadata'` marks placeholder chunks built from a source's own
 * title/abstract/key_claims (see api/admin/knowledge/reindex.ts). They are NOT
 * full-text evidence — api/_ans/ragStatus.ts already refuses to call them
 * functional RAG — so they must never be injected as quoted passages.
 */
export const METADATA_SECTION = "metadata";

/** Publication types whose passages are spoken words, not written literature. */
const TRANSCRIPT_TYPES = new Set(["transcript", "consultation", "lecture", "webinar", "interview", "video"]);

function isTranscriptSource(row: PassageRow): boolean {
  const type = (row.source?.publication_type ?? "").toLowerCase();
  if (TRANSCRIPT_TYPES.has(type)) return true;
  const title = (row.source?.title ?? "").toLowerCase();
  return /transcript|consultation|webinar|lecture|interview/.test(title);
}

/** Is this row eligible to be quoted at all (approved, active, real full text)? */
export function isEligiblePassage(row: PassageRow): boolean {
  const src = row.source;
  if (!src) return false;
  if (src.active_in_ai_analysis !== true) return false;
  if (src.review_status !== "approved") return false;
  if (typeof row.content !== "string" || row.content.trim().length === 0) return false;
  // Metadata placeholders are not full-text grounding.
  if ((row.section ?? "").trim().toLowerCase() === METADATA_SECTION) return false;
  return true;
}

/**
 * Citation locator: page when available, else the curator's section title, else
 * the chunk index — always honest about how precisely we can point.
 */
export function passageCitation(row: PassageRow): string {
  const title = row.source?.title?.trim() || "(untitled source)";
  const year = row.source?.year ? ` (${row.source.year})` : "";
  const locator =
    row.page != null
      ? `p.${row.page}`
      : row.section && row.section.trim()
        ? row.section.trim()
        : row.chunk_index != null
          ? `chunk ${row.chunk_index}`
          : "location unknown";
  return `${title}${year}, ${locator}`;
}

export interface SelectOptions {
  /** Max passages to inject (prompt budget). */
  limit?: number;
  /** Max characters per passage before truncation. */
  maxChars?: number;
  /**
   * Minimum lexical score a passage must reach to be injected. Below this the
   * caller falls back to metadata/no-RAG grounding rather than padding the
   * prompt with weak matches.
   */
  minScore?: number;
}

export const DEFAULT_PASSAGE_LIMIT = 4;
export const DEFAULT_MAX_CHARS = 1200;
/**
 * `scoreChunk` = breadth*0.7 + density*100*0.3. A single incidental term match
 * in a long passage lands far below this; a passage genuinely about the query
 * matches several distinct terms. Tuned to exclude drive-by matches.
 */
export const DEFAULT_MIN_SCORE = 0.15;

/** Rank eligible passages for a query. Returns [] when nothing clears the bar. */
export function selectPassages(
  rows: PassageRow[],
  query: string,
  opts: SelectOptions = {},
): SelectedPassage[] {
  const limit = opts.limit ?? DEFAULT_PASSAGE_LIMIT;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  const eligible = (rows ?? []).filter(isEligiblePassage);
  if (eligible.length === 0) return [];

  const ranked: RankedChunk<PassageRow>[] = rankChunks(
    eligible,
    query,
    (r) => r.content ?? "",
    limit,
  );

  return ranked
    .filter((r) => r.score >= minScore)
    .map((r) => {
      const raw = (r.chunk.content ?? "").trim();
      const content = raw.length > maxChars ? raw.slice(0, maxChars).trimEnd() + "…" : raw;
      return {
        content,
        citation: passageCitation(r.chunk),
        score: r.score,
        matched: r.matched,
        isTranscript: isTranscriptSource(r.chunk),
        sourceId: r.chunk.source_id ?? r.chunk.source?.id ?? null,
      };
    });
}

/**
 * Build the RETRIEVED PASSAGES prompt block. Returns "" when there is nothing
 * to inject, so the caller cleanly falls back to metadata / no-RAG grounding.
 */
export function buildPassagePromptSection(passages: SelectedPassage[]): string {
  if (passages.length === 0) return "";
  const anyTranscript = passages.some((p) => p.isTranscript);

  const lines: string[] = [
    "--------------------------------------------------",
    "RETRIEVED KNOWLEDGE PASSAGES (EXPLANATORY CONTEXT ONLY — NOT this patient's data)",
    "--------------------------------------------------",
    "These are verbatim excerpts retrieved from the curated knowledge corpus by",
    "deterministic term-overlap against the question. Use them to EXPLAIN concepts,",
    "terminology, and general physiology.",
    "",
    "Rules for this block (HIGHEST PRIORITY):",
    "- These passages are GENERAL reference material. They are NOT measurements of this patient.",
    "- NEVER use a passage to supply, infer, estimate, or fill in a patient value that the report",
    "  lists as \"Not assessed\" or that is missing. A passage can explain what a metric means; it",
    "  can never tell you what THIS patient's value was.",
    "- NEVER let a passage change, override, or re-grade any deterministic score, severity,",
    "  domain assessment, or vendor-reported finding. Those blocks remain authoritative for all",
    "  patient-specific facts; on any conflict, the report/vendor blocks win and you say so.",
    "- NEVER convert a threshold, cut-off, or rule-of-thumb mentioned in a passage into a computed",
    "  result or diagnosis for this patient. Do not apply a passage's numbers to this patient's data.",
    "- Cite a passage by its source title and locator exactly as given below when you rely on it.",
    // Dr. Colombo's output rule. Source text (papers, transcripts) legitimately
    // discusses generic HRV indices, so they may exist INTERNALLY in a passage —
    // but HumanOS work outputs are P&S (LFa/RFa/SB) and must not surface them.
    "- HRV-PARAMETER OUTPUT RULE (Dr. Colombo): a passage may internally mention generic",
    "  heart-rate-variability indices (e.g. SDNN, RMSSD, pNN50, LF/HF ratio, total power,",
    "  LF or HF power in ms^2). You must NOT surface, quote, tabulate, or report those HRV",
    "  parameters in your answer, and must NOT present them as this patient's results.",
    "  HumanOS reports P&S measures - LFa, RFa, and sympathovagal balance (LFa/RFa) - plus",
    "  the challenge-response findings. If a passage's explanation depends on an HRV index,",
    "  paraphrase the underlying physiology in P&S terms without emitting the HRV parameter.",
  ];

  if (anyTranscript) {
    lines.push(
      "- Passages marked [TRANSCRIPT] are attributed EXPLANATORY SPEECH from a recorded",
      "  consultation/lecture — a clinician's spoken teaching, not a peer-reviewed finding or a",
      "  validated protocol. Attribute them as spoken commentary (e.g. \"in a recorded consultation,",
      "  Dr. Colombo explains …\"), present them as explanation rather than established fact, and",
      "  state that such statements may require verification with the treating clinician.",
    );
  }

  lines.push("");
  passages.forEach((p, i) => {
    lines.push(`[P${i + 1}]${p.isTranscript ? " [TRANSCRIPT]" : ""} ${p.citation}`);
    lines.push(p.content);
    lines.push("");
  });
  lines.push("--------------------------------------------------");
  return lines.join("\n");
}
