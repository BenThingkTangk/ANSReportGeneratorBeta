/**
 * api/_knowledgeCache.ts
 * 60-second in-memory cache for active+approved knowledge sources.
 * Avoids Supabase round-trips on every AI request.
 */
import { createSupabaseAdmin } from "./_supabase.js";
import crypto from "crypto";

export interface KnowledgeCitation {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  url: string | null;
  publication_type: string | null;
}

export interface KnowledgeSource extends KnowledgeCitation {
  abstract: string | null;
  key_claims: unknown[];
}

interface CacheEntry {
  sources: KnowledgeSource[];
  hash: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
let _cache: CacheEntry | null = null;

export interface KnowledgeCorpusStatus {
  /** Approved+active source rows (metadata: title/abstract/claims). */
  activeSources: number;
  /** Rows in ans_knowledge_chunks (retrievable full-text/metadata passages). */
  totalChunks: number;
  /**
   * True only when there is a real retrievable corpus (chunks > 0). When false,
   * the source metadata is NOT a citable evidence base — ATOM must fall back to
   * report-only + clearly-labeled external grounding.
   */
  ragFunctional: boolean;
}

let _statusCache: { value: KnowledgeCorpusStatus; fetchedAt: number } | null = null;

/**
 * Cheap corpus status for grounding decisions. Counts chunks defensively — a
 * missing table/column or any error yields totalChunks:0 (safe: RAG treated as
 * non-functional), never a throw.
 */
export async function getKnowledgeCorpusStatus(): Promise<KnowledgeCorpusStatus> {
  const now = Date.now();
  if (_statusCache && now - _statusCache.fetchedAt < CACHE_TTL_MS) return _statusCache.value;
  let activeSources = 0;
  let totalChunks = 0;
  try {
    const admin = createSupabaseAdmin();
    const [{ count: src }, { count: ch }] = await Promise.all([
      admin
        .from("ans_knowledge_sources")
        .select("id", { count: "exact", head: true })
        .eq("active_in_ai_analysis", true)
        .eq("review_status", "approved"),
      admin.from("ans_knowledge_chunks").select("id", { count: "exact", head: true }),
    ]);
    activeSources = src ?? 0;
    totalChunks = ch ?? 0;
  } catch {
    /* fall through with zeros — RAG treated as non-functional */
  }
  const value: KnowledgeCorpusStatus = {
    activeSources,
    totalChunks,
    ragFunctional: totalChunks > 0,
  };
  _statusCache = { value, fetchedAt: now };
  return value;
}

export async function getActiveKnowledgeSources(): Promise<KnowledgeSource[]> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.sources;
  }

  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("ans_knowledge_sources")
      .select(
        "id, title, authors, year, url, publication_type, abstract, key_claims"
      )
      .eq("active_in_ai_analysis", true)
      .eq("review_status", "approved")
      .order("year", { ascending: false })
      .limit(12);

    if (error) {
      console.warn("Knowledge cache fetch error:", error.message);
      return _cache?.sources ?? [];
    }

    const sources = (data ?? []) as KnowledgeSource[];
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(sources.map((s) => s.id)))
      .digest("hex")
      .slice(0, 16);

    _cache = { sources, hash, fetchedAt: now };
    return sources;
  } catch (e) {
    console.warn("Knowledge cache exception:", e);
    return _cache?.sources ?? [];
  }
}

export function buildKnowledgePromptSection(
  sources: KnowledgeSource[],
  ragFunctional = true,
): string {
  if (sources.length === 0) return "";

  // GROUNDING HONESTY: when there is no retrievable full-text corpus (0 chunks),
  // the source rows are bibliographic METADATA only — a reading list, NOT an
  // evidence base we have actually retrieved passages from. In that state the
  // model must NOT cite these entries to support quantitative diagnostic
  // performance (sensitivity/specificity), prognosis ("lower near-term risk"),
  // or treatment claims. It may name them as background reading only.
  if (!ragFunctional) {
    const lines = [
      "---",
      "KNOWLEDGE LIBRARY STATUS — METADATA ONLY (NO FULL-TEXT CORPUS)",
      "The private knowledge base currently has 0 retrievable chunks. The entries below are",
      "bibliographic references (title/abstract) that have NOT been ingested as searchable",
      "passages. Therefore:",
      "  • Do NOT cite these entries with bracketed reference numbers as if quoting them.",
      "  • Do NOT state sensitivity, specificity, predictive value, prognosis, risk reduction,",
      "    or treatment efficacy sourced from them.",
      "  • Ground your answer in the PATIENT REPORT facts below and clearly-labeled general",
      "    physiology. If you cite external evidence, label it 'External (web)' with a real,",
      "    resolvable URL — never a bracketed private-corpus citation.",
      "Background reading (titles only, not retrieved):",
    ];
    for (const s of sources.slice(0, 6)) {
      lines.push(`  - ${s.title}${s.authors ? ` — ${s.authors}` : ""}${s.year ? ` (${s.year})` : ""}`);
    }
    lines.push("---");
    return lines.join("\n");
  }

  const lines = [
    "---",
    "KNOWLEDGE LIBRARY — Active Sources (Colombo P&S Evidence Base)",
    "Use these peer-reviewed and clinical sources to ground your response.",
    "",
  ];

  for (const s of sources) {
    const type = s.publication_type ?? "source";
    const year = s.year ?? "n.d.";
    const authors = s.authors ?? "Unknown";
    const abstractShort =
      s.abstract && s.abstract.length > 200
        ? s.abstract.slice(0, 197) + "…"
        : (s.abstract ?? "");
    const claims = Array.isArray(s.key_claims)
      ? (s.key_claims as string[]).slice(0, 3)
      : [];

    lines.push(`[${type.toUpperCase()}] ${s.title} — ${authors} (${year})`);
    if (abstractShort) lines.push(`  Summary: ${abstractShort}`);
    for (const claim of claims) {
      lines.push(`  • ${claim}`);
    }
    lines.push("");
  }

  lines.push("---");
  return lines.join("\n");
}

export function toCitations(sources: KnowledgeSource[]): KnowledgeCitation[] {
  return sources.map(({ id, title, authors, year, url, publication_type }) => ({
    id,
    title,
    authors,
    year,
    url,
    publication_type,
  }));
}
