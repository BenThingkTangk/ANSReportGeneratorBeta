/**
 * api/_evidenceRetrieval.ts
 *
 * Resolves deterministic rule references -> approved Knowledge Library sources.
 *
 * Reads from the AUTHORITATIVE Akamai Managed PostgreSQL store (humanos-ans-rag-pg)
 * via ./_ragDb — the SAME store admin CRUD writes to — so there is NO Supabase
 * split-brain: an admin-created/activated link is discoverable by the AI retriever
 * (after cache invalidation) and an archived/deactivated source instantly drops out.
 *
 * Safety guarantees:
 *   1. Only sources with active_in_ai_analysis=true AND review_status='approved'
 *      are ever returned. The SQL JOIN filters this server-side on every read.
 *   2. Never exposes raw private file bytes. `hasPrivateFile` is a boolean
 *      presence flag only; the bytes are served solely via the admin-gated
 *      streaming endpoint (api/admin/source-file).
 *   3. 60s in-memory cache keyed by (rule_type, rule_key) to keep report
 *      generation fast; admin mutations call clearEvidenceCache() for freshness.
 *   4. Fail-safe: any backend error returns the last good cache entry (or []),
 *      and the master toggle defaults to FALSE — never citations by accident.
 */

import { ragQuery } from "./_ragDb.js";
import type { EvidenceLink, RuleRef } from "../shared/evidenceTypes.js";

interface CacheEntry {
  links: EvidenceLink[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, CacheEntry>();

function cacheKey(ref: RuleRef): string {
  return `${ref.type}::${ref.key}`;
}

/** Force-clear the cache. Call after admin mutations to rule_evidence_links. */
export function clearEvidenceCache(): void {
  _cache.clear();
}

/** Row shape from the evidence-link ⋈ source JOIN. */
interface EvidenceRow {
  link_id: string;
  rule_type?: string;
  rule_key?: string;
  evidence_quote: string | null;
  page_ref: string | null;
  source_id: string;
  title: string;
  authors: string | null;
  year: number | null;
  url: string | null;
  publication_type: string | null;
  file_path: string | null;
}

function rowToLink(row: EvidenceRow): EvidenceLink {
  return {
    linkId: row.link_id,
    sourceId: row.source_id,
    title: row.title,
    authors: row.authors ?? null,
    year: row.year ?? null,
    publicationType: row.publication_type ?? null,
    url: row.url ?? null,
    hasPrivateFile: !!row.file_path,
    evidenceQuote: row.evidence_quote ?? null,
    pageRef: row.page_ref ?? null,
  };
}

/**
 * Fetch ACTIVE+APPROVED sources linked to a single rule reference.
 * Returns [] when no link exists OR the linked source is no longer approved.
 */
export async function getEvidenceForRule(ref: RuleRef): Promise<EvidenceLink[]> {
  const key = cacheKey(ref);
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.links;
  }

  try {
    // JOIN through the bridge table; filter for approved+active sources so an
    // archived/deactivated source can never be cited even if the link remains.
    const { rows } = await ragQuery<EvidenceRow>(
      `SELECT l.id AS link_id, l.evidence_quote, l.page_ref,
              s.id AS source_id, s.title, s.authors, s.year, s.url,
              s.publication_type, s.file_path
         FROM public.ans_rule_evidence_links l
         JOIN public.ans_knowledge_sources s ON s.id = l.source_id
        WHERE l.rule_type = $1
          AND l.rule_key = $2
          AND s.active_in_ai_analysis = true
          AND s.review_status = 'approved'`,
      [ref.type, ref.key]
    );

    const links = rows.map(rowToLink);
    _cache.set(key, { links, fetchedAt: now });
    return links;
  } catch (e) {
    console.warn("[evidence] fetch exception", (e as Error)?.message ?? "unknown");
    return cached?.links ?? [];
  }
}

/**
 * Batch lookup — fetches evidence for many rules grouped by type.
 * Falls back to per-rule cache when individual entries are warm.
 */
export async function getEvidenceForRules(
  refs: RuleRef[]
): Promise<Map<string, EvidenceLink[]>> {
  const out = new Map<string, EvidenceLink[]>();
  if (refs.length === 0) return out;

  const now = Date.now();
  const cold: RuleRef[] = [];

  for (const ref of refs) {
    const k = cacheKey(ref);
    const cached = _cache.get(k);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      out.set(k, cached.links);
    } else {
      cold.push(ref);
    }
  }

  if (cold.length === 0) return out;

  try {
    // Group cold refs by type, then one query per type using = ANY($2::text[]).
    const byType = new Map<string, string[]>();
    for (const ref of cold) {
      const arr = byType.get(ref.type) ?? [];
      arr.push(ref.key);
      byType.set(ref.type, arr);
    }

    for (const [type, keys] of Array.from(byType.entries())) {
      const { rows } = await ragQuery<EvidenceRow>(
        `SELECT l.id AS link_id, l.rule_type, l.rule_key, l.evidence_quote, l.page_ref,
                s.id AS source_id, s.title, s.authors, s.year, s.url,
                s.publication_type, s.file_path
           FROM public.ans_rule_evidence_links l
           JOIN public.ans_knowledge_sources s ON s.id = l.source_id
          WHERE l.rule_type = $1
            AND l.rule_key = ANY($2::text[])
            AND s.active_in_ai_analysis = true
            AND s.review_status = 'approved'`,
        [type, keys]
      );

      // Initialise empty buckets so a cold-miss = empty (not undefined).
      for (const k of keys) {
        out.set(`${type}::${k}`, []);
      }

      for (const row of rows) {
        const k = `${row.rule_type}::${row.rule_key}`;
        const arr = out.get(k) ?? [];
        arr.push(rowToLink(row));
        out.set(k, arr);
      }
    }

    // Refresh cache for cold entries (even empty buckets).
    for (const ref of cold) {
      const k = cacheKey(ref);
      _cache.set(k, { links: out.get(k) ?? [], fetchedAt: now });
    }
  } catch (e) {
    console.warn("[evidence] batch exception", (e as Error)?.message ?? "unknown");
  }

  return out;
}

/**
 * Read the master toggle from app_settings. Defaults to FALSE on any error
 * (fail-safe — no citations unless explicitly enabled). The `value` column is
 * jsonb, so pg returns the parsed JSON (boolean true) directly.
 */
export async function isEvidenceEnabled(): Promise<boolean> {
  try {
    const { rows } = await ragQuery<{ value: unknown }>(
      `SELECT value FROM public.app_settings
        WHERE key = 'evidence_linked_explanations_enabled'`
    );
    if (rows.length === 0) return false;
    return rows[0].value === true;
  } catch {
    return false;
  }
}
