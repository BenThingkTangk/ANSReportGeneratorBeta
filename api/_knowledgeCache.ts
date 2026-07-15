/**
 * api/_knowledgeCache.ts
 * 60-second in-memory cache for active+approved knowledge sources.
 * Reads from the AUTHORITATIVE Akamai Managed PostgreSQL store (humanos-ans-rag-pg)
 * via ./_ragDb — the SAME store admin CRUD writes to — so admin edits reach AI
 * grounding without a Supabase split-brain. Avoids a DB round-trip on every AI
 * request; fail-safe returns the last good snapshot (or []) on any backend error.
 */
import { ragQuery } from "./_ragDb.js";
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

/**
 * Force-clear the active-sources cache. Called after any admin mutation to a
 * knowledge source (create/update/activate/archive/delete/upload) so the next AI
 * request re-reads the authoritative PostgreSQL store immediately on the same
 * warm instance. The 60s TTL bounds staleness across other warm instances.
 */
export function clearKnowledgeCache(): void {
  _cache = null;
}

export async function getActiveKnowledgeSources(): Promise<KnowledgeSource[]> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.sources;
  }

  try {
    // Authoritative read from Akamai PostgreSQL. NULLS LAST keeps undated
    // sources after dated ones. key_claims is jsonb → pg returns it parsed.
    const { rows } = await ragQuery<KnowledgeSource>(
      `SELECT id, title, authors, year, url, publication_type, abstract, key_claims
         FROM public.ans_knowledge_sources
        WHERE active_in_ai_analysis = true
          AND review_status = 'approved'
        ORDER BY year DESC NULLS LAST
        LIMIT 12`
    );

    const sources = rows.map((r) => ({
      ...r,
      key_claims: Array.isArray(r.key_claims) ? r.key_claims : [],
    })) as KnowledgeSource[];
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(sources.map((s) => s.id)))
      .digest("hex")
      .slice(0, 16);

    _cache = { sources, hash, fetchedAt: now };
    return sources;
  } catch (e) {
    console.warn("Knowledge cache exception:", (e as Error)?.message ?? "unknown");
    return _cache?.sources ?? [];
  }
}

export function buildKnowledgePromptSection(
  sources: KnowledgeSource[]
): string {
  if (sources.length === 0) return "";

  const lines = [
    "---",
    "KNOWLEDGE LIBRARY — Active Sources (Colombo P&S Evidence Base)",
    "Use these sources to ground your response. Sources are a mix of published,",
    "peer-reviewed literature and internal clinical material; items tagged",
    "(internal, non-peer-reviewed) are practitioner protocols/notes, not published",
    "evidence — weight them accordingly and never present them as peer-reviewed.",
    "",
  ];

  for (const s of sources) {
    const type = s.publication_type ?? "source";
    const year = s.year ?? "n.d.";
    const authors = s.authors ?? "Unknown";
    // Flag non-peer-reviewed internal material so the model never over-states it.
    const isInternal = type === "internal_protocol" || type === "note";
    const provenance = isInternal ? " (internal, non-peer-reviewed)" : "";
    const abstractShort =
      s.abstract && s.abstract.length > 200
        ? s.abstract.slice(0, 197) + "…"
        : (s.abstract ?? "");
    const claims = Array.isArray(s.key_claims)
      ? (s.key_claims as string[]).slice(0, 3)
      : [];

    lines.push(`[${type.toUpperCase()}] ${s.title} — ${authors} (${year})${provenance}`);
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
