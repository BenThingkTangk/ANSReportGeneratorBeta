/**
 * Regression: ans_knowledge_chunks schema detection must handle the LEGACY
 * schema (no page/section columns) without crashing — reproducing the live
 * PostgREST behavior where selecting a missing column returns error 42703
 * ("column ans_knowledge_chunks.page does not exist"). This is the exact QA
 * failure on the protected preview.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { detectChunkSchema, chunkSelectColumns, _resetChunkSchemaCache } from "../knowledgeSchema.js";

/** A fake Supabase whose chunk-column probes fail with 42703 for the columns
 *  named in `missing`, and succeed otherwise. */
function fakeSupabase(missing: string[]) {
  return {
    from(_table: string) {
      return {
        select(cols: string, _opts?: any) {
          // A probe selects exactly one column name.
          const col = cols.trim();
          if (missing.includes(col)) {
            return Promise.resolve({
              error: { code: "42703", message: `column ans_knowledge_chunks.${col} does not exist` },
              data: null,
            });
          }
          return Promise.resolve({ error: null, data: [], count: 0 });
        },
      };
    },
  };
}

/** Variant that reports the missing column only via message (no SQLSTATE). */
function fakeSupabaseMsgOnly(missing: string[]) {
  return {
    from(_t: string) {
      return {
        select(cols: string) {
          if (missing.includes(cols.trim())) {
            return Promise.resolve({ error: { message: `Could not find the '${cols.trim()}' column of 'ans_knowledge_chunks'` } });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

beforeEach(() => _resetChunkSchemaCache());

describe("detectChunkSchema", () => {
  it("detects the LEGACY schema when page + section are both missing (42703)", async () => {
    const s = await detectChunkSchema(fakeSupabase(["page", "section"]), true);
    expect(s).toEqual({ hasPage: false, hasSection: false, schemaVersion: "0001" });
  });

  it("detects the migration-0005 schema when both columns exist", async () => {
    const s = await detectChunkSchema(fakeSupabase([]), true);
    expect(s).toEqual({ hasPage: true, hasSection: true, schemaVersion: "0005" });
  });

  it("detects a partial schema (one column only)", async () => {
    const s = await detectChunkSchema(fakeSupabase(["page"]), true);
    expect(s).toEqual({ hasPage: false, hasSection: true, schemaVersion: "partial" });
  });

  it("recognizes a message-only missing-column error (no SQLSTATE)", async () => {
    const s = await detectChunkSchema(fakeSupabaseMsgOnly(["page", "section"]), true);
    expect(s.hasPage).toBe(false);
    expect(s.hasSection).toBe(false);
  });

  it("treats an inconclusive error (e.g. RLS) as column-absent (safe path)", async () => {
    const rlsFail = {
      from: () => ({ select: () => Promise.resolve({ error: { code: "42501", message: "permission denied" } }) }),
    };
    const s = await detectChunkSchema(rlsFail, true);
    expect(s.schemaVersion).toBe("0001");
  });
});

describe("chunkSelectColumns", () => {
  it("omits page/section on the legacy schema (never selects a missing column)", () => {
    const cols = chunkSelectColumns({ hasPage: false, hasSection: false, schemaVersion: "0001" });
    expect(cols).toBe("id, source_id, chunk_index, content, tokens");
    expect(cols).not.toContain("page");
    expect(cols).not.toContain("section");
  });

  it("includes page/section on the migration-0005 schema", () => {
    const cols = chunkSelectColumns({ hasPage: true, hasSection: true, schemaVersion: "0005" });
    expect(cols).toContain("page");
    expect(cols).toContain("section");
  });
});
