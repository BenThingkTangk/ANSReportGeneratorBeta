/**
 * api/_evidenceRetrieval.ts
 *
 * Resolves deterministic rule references -> approved Knowledge Library sources.
 *
 * Safety guarantees:
 *   1. Only sources with active_in_ai_analysis=true AND review_status='approved'
 *      are ever returned. The DB join filters this server-side every read.
 *   2. Never exposes raw private bucket paths. Callers requesting a downloadable
 *      reference must use createSignedFileUrl() which is admin-gated upstream.
 *   3. 60s in-memory cache keyed by (rule_type, rule_key) to keep report
 *      generation fast without losing freshness when admins approve sources.
 */

import { createSupabaseAdmin } from "./_supabase.js";
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
    const admin = createSupabaseAdmin();
    // Join through the bridge table; filter for approved+active sources.
    const { data, error } = await admin
      .from("ans_rule_evidence_links")
      .select(
        `
          id,
          evidence_quote,
          page_ref,
          source:ans_knowledge_sources!inner (
            id, title, authors, year, url, publication_type, file_path,
            active_in_ai_analysis, review_status
          )
        `
      )
      .eq("rule_type", ref.type)
      .eq("rule_key", ref.key)
      .eq("source.active_in_ai_analysis", true)
      .eq("source.review_status", "approved");

    if (error) {
      console.warn("[evidence] fetch error", error.message);
      return cached?.links ?? [];
    }

    const links: EvidenceLink[] = (data ?? []).map((row: any) => {
      const src = row.source;
      return {
        linkId: row.id,
        sourceId: src.id,
        title: src.title,
        authors: src.authors ?? null,
        year: src.year ?? null,
        publicationType: src.publication_type ?? null,
        url: src.url ?? null,
        hasPrivateFile: !!src.file_path,
        evidenceQuote: row.evidence_quote ?? null,
        pageRef: row.page_ref ?? null,
      };
    });

    _cache.set(key, { links, fetchedAt: now });
    return links;
  } catch (e) {
    console.warn("[evidence] exception", e);
    return cached?.links ?? [];
  }
}

/**
 * Batch lookup — fetches evidence for many rules in a single round-trip.
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
    const admin = createSupabaseAdmin();
    // Build OR filter: (rule_type=X AND rule_key=Y) OR ...
    // Supabase doesn't support compound OR easily, so we fetch by type-buckets.
    const byType = new Map<string, string[]>();
    for (const ref of cold) {
      const arr = byType.get(ref.type) ?? [];
      arr.push(ref.key);
      byType.set(ref.type, arr);
    }

    for (const [type, keys] of byType.entries()) {
      const { data, error } = await admin
        .from("ans_rule_evidence_links")
        .select(
          `
            id, rule_type, rule_key,
            evidence_quote, page_ref,
            source:ans_knowledge_sources!inner (
              id, title, authors, year, url, publication_type, file_path,
              active_in_ai_analysis, review_status
            )
          `
        )
        .eq("rule_type", type)
        .in("rule_key", keys)
        .eq("source.active_in_ai_analysis", true)
        .eq("source.review_status", "approved");

      if (error) {
        console.warn("[evidence] batch fetch error", error.message);
        continue;
      }

      // Initialise empty buckets so cold-miss = empty (not undefined).
      for (const k of keys) {
        out.set(`${type}::${k}`, []);
      }

      for (const row of data ?? []) {
        const src = (row as any).source;
        const link: EvidenceLink = {
          linkId: (row as any).id,
          sourceId: src.id,
          title: src.title,
          authors: src.authors ?? null,
          year: src.year ?? null,
          publicationType: src.publication_type ?? null,
          url: src.url ?? null,
          hasPrivateFile: !!src.file_path,
          evidenceQuote: (row as any).evidence_quote ?? null,
          pageRef: (row as any).page_ref ?? null,
        };
        const k = `${(row as any).rule_type}::${(row as any).rule_key}`;
        const arr = out.get(k) ?? [];
        arr.push(link);
        out.set(k, arr);
      }
    }

    // Refresh cache for cold entries (even empty buckets).
    for (const ref of cold) {
      const k = cacheKey(ref);
      _cache.set(k, { links: out.get(k) ?? [], fetchedAt: now });
    }
  } catch (e) {
    console.warn("[evidence] batch exception", e);
  }

  return out;
}

/**
 * Read the master toggle from app_settings. Defaults to FALSE on any error
 * (fail-safe — no citations unless explicitly enabled).
 */
export async function isEvidenceEnabled(): Promise<boolean> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "evidence_linked_explanations_enabled")
      .maybeSingle();
    if (error || !data) return false;
    return data.value === true;
  } catch {
    return false;
  }
}

/**
 * Create a short-lived signed URL for a private knowledge-files object.
 * Caller MUST have verified admin/reviewer role before calling this.
 *
 * @param filePath Storage key within the 'knowledge-files' bucket
 * @param ttlSeconds expiry (default 5 minutes)
 */
export async function createSignedFileUrl(
  filePath: string,
  ttlSeconds: number = 300
): Promise<string | null> {
  if (!filePath) return null;
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin.storage
      .from("knowledge-files")
      .createSignedUrl(filePath, ttlSeconds);
    if (error || !data?.signedUrl) {
      console.warn("[evidence] signed url error", error?.message);
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    console.warn("[evidence] signed url exception", e);
    return null;
  }
}
