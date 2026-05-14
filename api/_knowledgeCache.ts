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
  sources: KnowledgeSource[]
): string {
  if (sources.length === 0) return "";

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
