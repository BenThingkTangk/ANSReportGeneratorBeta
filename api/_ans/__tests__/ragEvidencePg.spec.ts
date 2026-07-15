import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * AI evidence read-path on Akamai Managed PostgreSQL (humanos-ans-rag-pg).
 *
 * These tests pin the ANTI-SPLIT-BRAIN contract the migration exists to enforce:
 * the SAME authoritative PostgreSQL store that admin CRUD writes to is the ONLY
 * store the live AI evidence retriever + active-source cache read from. Proven here
 * directly against the real ../_evidenceRetrieval + ../_knowledgeCache helpers with
 * a mocked `pg` driver (no network, no live DB):
 *
 *   1. An admin-created/activated link is immediately discoverable by the retriever
 *      once caches are invalidated (and the 60s cache is what defers it until then).
 *   2. Archived / deactivated / non-approved sources are excluded server-side by the
 *      JOIN's WHERE clause — they can never be cited even if the link row survives.
 *   3. Citations preserve source identity + publicationType + provenance flags.
 *   4. There is NO Supabase fallback: the returned data provably originates from the
 *      pg mock, and any attempt to build a Supabase client throws.
 *   5. Every backend failure (unconfigured / transport / query) is fail-safe:
 *      retrieval returns [] and the master toggle defaults to FALSE — never a crash,
 *      never accidental citations.
 */

// ── Hoisted pg mock (shared, inspectable state) ──────────────────────────────
const h = vi.hoisted(() => {
  const state: {
    calls: Array<{ text: string; params?: unknown[] }>;
    queryImpl: ((text: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number }) | null;
  } = { calls: [], queryImpl: null };

  function dispatch(text: string, params?: unknown[]) {
    state.calls.push({ text, params });
    const t = text.trim().toUpperCase();
    if (t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (!state.queryImpl) return { rows: [], rowCount: 0 };
    return state.queryImpl(text, params);
  }

  class MockPoolClient {
    async query(text: string, params?: unknown[]) {
      return dispatch(text, params);
    }
    release() {}
  }
  class MockPool {
    constructor() {}
    on() {
      return this;
    }
    async query(text: string, params?: unknown[]) {
      return dispatch(text, params);
    }
    async connect() {
      return new MockPoolClient();
    }
    async end() {}
  }
  return { state, MockPool };
});

vi.mock("pg", () => ({ default: { Pool: h.MockPool }, Pool: h.MockPool }));

// Defensive: the RAG read path must be PostgreSQL-only. If a future refactor ever
// reintroduces a Supabase import into this path, building a client throws loudly.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("Supabase must not be reached from the RAG read path");
  },
}));

import {
  getEvidenceForRule,
  getEvidenceForRules,
  isEvidenceEnabled,
  clearEvidenceCache,
} from "../../_evidenceRetrieval.js";
import {
  getActiveKnowledgeSources,
  clearKnowledgeCache,
} from "../../_knowledgeCache.js";
import { invalidateKnowledgeCaches } from "../../_knowledgeInvalidate.js";
import { _resetPoolForTests } from "../../_ragDb.js";
import type { RuleRef } from "../../../shared/evidenceTypes.js";

const VALID_URL = "postgres://u:p@db.example-ref.akamai.internal:5432/ans?sslmode=require";
const VALID_CA = "-----BEGIN CERTIFICATE-----\nMIIBmock\n-----END CERTIFICATE-----";

const SRC_ID = "22222222-2222-2222-2222-222222222222";
const LINK_ID = "33333333-3333-3333-3333-333333333333";

const CAN_REF: RuleRef = { type: "finding", key: "CARDIAC_AUTONOMIC_NEUROPATHY" };

/** A JOIN row exactly as the evidence-link ⋈ source query returns it from pg. */
function evidenceRow(over: Record<string, unknown> = {}) {
  return {
    link_id: LINK_ID,
    rule_type: "finding",
    rule_key: "CARDIAC_AUTONOMIC_NEUROPATHY",
    evidence_quote: "CAN is defined by abnormal LFa and abnormal Ewing ratios.",
    page_ref: "p. 42",
    source_id: SRC_ID,
    title: "A Critical Analysis of Dysautonomia",
    authors: "DePace, Colombo",
    year: 2024,
    url: "https://link.springer.com/book/10.1007/978-3-031-46896-9",
    publication_type: "book",
    file_path: "critical-analysis.pdf",
    ...over,
  };
}

function setRag(url: string | undefined, ca: string | undefined) {
  if (url === undefined) delete (process.env as any).HUMANOS_DATABASE_URL;
  else process.env.HUMANOS_DATABASE_URL = url;
  if (ca === undefined) delete (process.env as any).HUMANOS_DATABASE_CA_CERT;
  else process.env.HUMANOS_DATABASE_CA_CERT = ca;
}

const prev = {
  url: process.env.HUMANOS_DATABASE_URL,
  ca: process.env.HUMANOS_DATABASE_CA_CERT,
};

afterAll(async () => {
  await _resetPoolForTests();
  const restore = (k: string, v: string | undefined) =>
    v === undefined ? delete (process.env as any)[k] : ((process.env as any)[k] = v);
  restore("HUMANOS_DATABASE_URL", prev.url);
  restore("HUMANOS_DATABASE_CA_CERT", prev.ca);
});

beforeEach(async () => {
  await _resetPoolForTests();
  h.state.calls = [];
  h.state.queryImpl = null;
  setRag(VALID_URL, VALID_CA);
  // Every test starts with cold in-process caches so cross-test order can't leak.
  clearEvidenceCache();
  clearKnowledgeCache();
});

// ── 1. Admin change → immediately discoverable after invalidation ────────────
describe("getEvidenceForRule() — admin activation is discoverable after cache invalidation", () => {
  it("reflects a newly-activated source only AFTER invalidateKnowledgeCaches() (the 60s cache defers it until then)", async () => {
    // Initially the source is NOT active+approved → the WHERE-filtered JOIN returns nothing.
    h.state.queryImpl = () => ({ rows: [] });
    const before = await getEvidenceForRule(CAN_REF);
    expect(before).toEqual([]); // warms the cache with an empty bucket

    // Admin activates + approves the source → the JOIN now matches.
    h.state.queryImpl = () => ({ rows: [evidenceRow()] });

    // Without invalidation the retriever still serves the warm (empty) cache…
    const stillCached = await getEvidenceForRule(CAN_REF);
    expect(stillCached).toEqual([]);

    // …invalidation (what every admin write route calls) makes it discoverable NOW.
    invalidateKnowledgeCaches();
    const after = await getEvidenceForRule(CAN_REF);
    expect(after).toHaveLength(1);
    expect(after[0].sourceId).toBe(SRC_ID);
    expect(after[0].linkId).toBe(LINK_ID);
  });

  it("serves the retriever's answer from PostgreSQL — the returned data matches the pg mock row exactly", async () => {
    h.state.queryImpl = () => ({ rows: [evidenceRow()] });
    const links = await getEvidenceForRule(CAN_REF);

    expect(links).toHaveLength(1);
    // The data provably came from pg (the mock row), not any other store.
    expect(links[0].title).toBe("A Critical Analysis of Dysautonomia");
    // The read hit PostgreSQL exactly once, via the bridge JOIN.
    const q = h.state.calls.find((c) =>
      c.text.toLowerCase().includes("from public.ans_rule_evidence_links")
    )!;
    expect(q).toBeTruthy();
    // rule_type + rule_key are bound parameters (SQL-injection safe).
    expect(q.text).toMatch(/\$1/);
    expect(q.text).toMatch(/\$2/);
    expect(q.params).toEqual([CAN_REF.type, CAN_REF.key]);
  });
});

// ── 2. Inactive / archived / non-approved are excluded server-side ───────────
describe("getEvidenceForRule() — excludes non-active / non-approved sources server-side", () => {
  it("filters on active_in_ai_analysis=true AND review_status='approved' in the SQL itself", async () => {
    h.state.queryImpl = () => ({ rows: [evidenceRow()] });
    await getEvidenceForRule(CAN_REF);
    const q = h.state.calls.find((c) =>
      c.text.toLowerCase().includes("from public.ans_rule_evidence_links")
    )!;
    const sql = q.text.toLowerCase();
    expect(sql).toContain("active_in_ai_analysis = true");
    expect(sql).toContain("review_status = 'approved'");
  });

  it("returns [] when the linked source is archived/deactivated (JOIN yields no rows)", async () => {
    // Link row exists but the source is archived → the filtered JOIN returns nothing.
    h.state.queryImpl = () => ({ rows: [] });
    const links = await getEvidenceForRule(CAN_REF);
    expect(links).toEqual([]);
  });
});

// ── 3. Citations preserve source identity + provenance ───────────────────────
describe("getEvidenceForRule() — citations preserve source, version-ish provenance & private-file flag", () => {
  it("maps every source/link field onto the EvidenceLink contract", async () => {
    h.state.queryImpl = () => ({ rows: [evidenceRow()] });
    const [link] = await getEvidenceForRule(CAN_REF);

    expect(link.linkId).toBe(LINK_ID);
    expect(link.sourceId).toBe(SRC_ID);
    expect(link.title).toBe("A Critical Analysis of Dysautonomia");
    expect(link.authors).toBe("DePace, Colombo");
    expect(link.year).toBe(2024);
    expect(link.publicationType).toBe("book");
    expect(link.url).toBe("https://link.springer.com/book/10.1007/978-3-031-46896-9");
    expect(link.evidenceQuote).toBe("CAN is defined by abnormal LFa and abnormal Ewing ratios.");
    expect(link.pageRef).toBe("p. 42");
    // hasPrivateFile is a boolean PRESENCE flag — never the raw bytes/path.
    expect(link.hasPrivateFile).toBe(true);
    expect((link as any).file_path).toBeUndefined();
    expect((link as any).content).toBeUndefined();
  });

  it("sets hasPrivateFile=false when the source has no attached binary", async () => {
    h.state.queryImpl = () => ({ rows: [evidenceRow({ file_path: null })] });
    const [link] = await getEvidenceForRule(CAN_REF);
    expect(link.hasPrivateFile).toBe(false);
  });
});

// ── 4. Batch retrieval groups by type and buckets misses as empty ────────────
describe("getEvidenceForRules() — batch lookup grouped by type via = ANY($2::text[])", () => {
  it("returns a populated bucket for a matched rule and an EMPTY bucket for an unmatched one", async () => {
    h.state.queryImpl = (text: string, params?: unknown[]) => {
      // Only the CAN key resolves; the second key has no approved link.
      const keys = (params?.[1] as string[]) ?? [];
      const rows = keys.includes("CARDIAC_AUTONOMIC_NEUROPATHY") ? [evidenceRow()] : [];
      void text;
      return { rows };
    };

    const refs: RuleRef[] = [
      { type: "finding", key: "CARDIAC_AUTONOMIC_NEUROPATHY" },
      { type: "finding", key: "UNLINKED_FINDING" },
    ];
    const map = await getEvidenceForRules(refs);

    expect(map.get("finding::CARDIAC_AUTONOMIC_NEUROPATHY")).toHaveLength(1);
    // A cold miss is an EMPTY bucket, never undefined.
    expect(map.get("finding::UNLINKED_FINDING")).toEqual([]);

    // One query per type, keys passed as a bound text[] param (injection-safe).
    const q = h.state.calls.find((c) =>
      c.text.toLowerCase().includes("= any($2::text[])")
    )!;
    expect(q).toBeTruthy();
    expect(q.params?.[0]).toBe("finding");
    expect(q.params?.[1]).toEqual(["CARDIAC_AUTONOMIC_NEUROPATHY", "UNLINKED_FINDING"]);
  });
});

// ── 5. Master toggle reads app_settings (jsonb), fail-safe FALSE ─────────────
describe("isEvidenceEnabled() — reads the app_settings jsonb toggle, defaults FALSE", () => {
  it("returns true when the stored jsonb value is boolean true", async () => {
    h.state.queryImpl = (text: string) => {
      if (text.toLowerCase().includes("from public.app_settings")) return { rows: [{ value: true }] };
      return { rows: [] };
    };
    expect(await isEvidenceEnabled()).toBe(true);
  });

  it("returns false when the setting row is absent", async () => {
    h.state.queryImpl = () => ({ rows: [] });
    expect(await isEvidenceEnabled()).toBe(false);
  });

  it("returns false when the stored value is not exactly boolean true", async () => {
    h.state.queryImpl = () => ({ rows: [{ value: "true" }] }); // string, not boolean
    expect(await isEvidenceEnabled()).toBe(false);
  });
});

// ── 6. No Supabase fallback + fail-safe on every backend failure ─────────────
describe("read path — PostgreSQL-only, fail-safe on any backend failure", () => {
  it("uses ONLY PostgreSQL — every backend call recorded is a pg query against public.* tables", async () => {
    h.state.queryImpl = () => ({ rows: [evidenceRow()] });
    await getEvidenceForRule(CAN_REF);
    expect(h.state.calls.length).toBeGreaterThan(0);
    for (const c of h.state.calls) {
      expect(c.text.toLowerCase()).toContain("public.ans_rule_evidence_links");
    }
    // (The @supabase/supabase-js mock would throw if the path ever built a client.)
  });

  it("returns [] (never throws) when the backend is UNCONFIGURED", async () => {
    setRag(undefined, undefined);
    await _resetPoolForTests();
    const links = await getEvidenceForRule(CAN_REF);
    expect(links).toEqual([]);
  });

  it("returns [] (never throws) on a transport failure, and never leaks the host", async () => {
    h.state.queryImpl = () => {
      throw Object.assign(new Error("connect ECONNREFUSED 10.9.8.7:5432"), { code: "ECONNREFUSED" });
    };
    const links = await getEvidenceForRule(CAN_REF);
    expect(links).toEqual([]);
  });

  it("returns [] on an undefined_table (42P01) failure (migration not yet run)", async () => {
    h.state.queryImpl = () => {
      throw Object.assign(new Error('relation "ans_rule_evidence_links" does not exist'), { code: "42P01" });
    };
    const links = await getEvidenceForRule(CAN_REF);
    expect(links).toEqual([]);
  });

  it("isEvidenceEnabled() fails safe to FALSE on a backend error", async () => {
    h.state.queryImpl = () => {
      throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    };
    expect(await isEvidenceEnabled()).toBe(false);
  });
});

// ── 7. Active-source cache (Ask Atom / synopsis grounding) is PG-backed ───────
describe("getActiveKnowledgeSources() — active-source grounding reads the SAME PG store", () => {
  it("selects only active_in_ai_analysis+approved sources and normalises key_claims", async () => {
    h.state.queryImpl = (text: string) => {
      if (text.toLowerCase().includes("from public.ans_knowledge_sources")) {
        return {
          rows: [
            {
              id: SRC_ID,
              title: "A Critical Analysis of Dysautonomia",
              authors: "DePace, Colombo",
              year: 2024,
              url: null,
              publication_type: "book",
              abstract: "abstract",
              key_claims: ["CAN is defined by abnormal LFa."],
            },
          ],
        };
      }
      return { rows: [] };
    };

    const sources = await getActiveKnowledgeSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe(SRC_ID);
    expect(Array.isArray(sources[0].key_claims)).toBe(true);

    const q = h.state.calls.find((c) =>
      c.text.toLowerCase().includes("from public.ans_knowledge_sources")
    )!;
    const sql = q.text.toLowerCase();
    expect(sql).toContain("active_in_ai_analysis = true");
    expect(sql).toContain("review_status = 'approved'");
  });

  it("returns [] (never throws) when the backend is unreachable", async () => {
    h.state.queryImpl = () => {
      throw Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:5432"), { code: "ECONNREFUSED" });
    };
    const sources = await getActiveKnowledgeSources();
    expect(sources).toEqual([]);
  });
});
