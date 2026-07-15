/**
 * api/_knowledgeInvalidate.ts
 * Single entry point admin write routes call after mutating the authoritative
 * knowledge store, so the AI read path (active-sources cache + rule-evidence
 * cache) reflects the change on the next request from this warm instance.
 *
 * Both underlying caches are in-process with a 60s TTL, so this clears the
 * CURRENT instance immediately and the TTL bounds staleness on other warm
 * instances — the same freshness contract the read path already relies on.
 * It never throws: a cache-clear failure must never fail an admin action.
 */
import { clearKnowledgeCache } from "./_knowledgeCache.js";
import { clearEvidenceCache } from "./_evidenceRetrieval.js";

export function invalidateKnowledgeCaches(): void {
  try {
    clearKnowledgeCache();
  } catch {
    /* best-effort */
  }
  try {
    clearEvidenceCache();
  } catch {
    /* best-effort */
  }
}
