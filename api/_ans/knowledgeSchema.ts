/**
 * api/_ans/knowledgeSchema.ts
 *
 * Runtime detection of the ans_knowledge_chunks schema. Migration 0005 adds
 * optional `page` and `section` columns, but we MUST NOT assume it has been
 * applied — a deployed DB may still be on the legacy schema (id, source_id,
 * chunk_index, content, tokens, created_at). Selecting a non-existent column
 * makes PostgREST return error 42703 ("column ... does not exist") and crashes
 * the request. This module probes once (cached) so retrieval, health, and
 * ingestion adapt to whichever schema is live and NEVER crash on missing
 * optional columns.
 */

/**
 * Minimal structural shape we rely on. The real Supabase query builder is a
 * thenable (not a Promise), so we type the select result as `PromiseLike` and
 * accept `any` for the builder chain — the concrete client satisfies this.
 */
interface SupabaseLike {
  from: (table: string) => any;
}

export interface KnowledgeChunkSchema {
  /** True when the `page` column exists (migration 0005 applied). */
  hasPage: boolean;
  /** True when the `section` column exists (migration 0005 applied). */
  hasSection: boolean;
  /** "0005" when both optional columns exist, else "0001" (legacy base). */
  schemaVersion: "0001" | "0005" | "partial";
}

/** PostgREST "undefined column" error code. */
const UNDEFINED_COLUMN = "42703";

let _cache: KnowledgeChunkSchema | null = null;

/** True if a probe error indicates the selected column does not exist. */
function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === UNDEFINED_COLUMN) return true;
  // Some PostgREST versions omit the SQLSTATE and only give a message.
  return /column .*does not exist|could not find the .* column/i.test(err.message ?? "");
}

/**
 * Detect which optional columns exist on ans_knowledge_chunks. Probes each
 * optional column with a `head` (count-only, no rows) select so it is cheap and
 * side-effect-free. Cached process-wide (schema does not change within a
 * process lifetime). Pass `force` to bypass the cache (tests).
 */
export async function detectChunkSchema(
  supabase: SupabaseLike,
  force = false,
): Promise<KnowledgeChunkSchema> {
  if (_cache && !force) return _cache;

  const probe = async (col: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("ans_knowledge_chunks")
        .select(col, { head: true, count: "exact" });
      if (isMissingColumn(error)) return false;
      // Any OTHER error (RLS, connectivity) is inconclusive → treat the column
      // as absent so we stay on the safe legacy path rather than risk a crash.
      if (error) return false;
      return true;
    } catch {
      return false;
    }
  };

  const [hasPage, hasSection] = await Promise.all([probe("page"), probe("section")]);
  const schemaVersion: KnowledgeChunkSchema["schemaVersion"] =
    hasPage && hasSection ? "0005" : hasPage || hasSection ? "partial" : "0001";
  _cache = { hasPage, hasSection, schemaVersion };
  return _cache;
}

/** Reset the cached schema (tests only). */
export function _resetChunkSchemaCache(): void {
  _cache = null;
}

/**
 * Build the SELECT column list for ans_knowledge_chunks given the detected
 * schema — includes `page`/`section` only when they exist so the query never
 * references a missing column.
 */
export function chunkSelectColumns(schema: KnowledgeChunkSchema): string {
  const cols = ["id", "source_id", "chunk_index", "content", "tokens"];
  if (schema.hasPage) cols.push("page");
  if (schema.hasSection) cols.push("section");
  return cols.join(", ");
}
