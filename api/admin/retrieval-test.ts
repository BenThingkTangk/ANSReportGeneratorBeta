import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  requireRole,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";
import { tokenizeQuery, scoreChunk } from "../_ans/knowledgeChunking.js";

/**
 * POST /api/admin/retrieval-test
 *
 * Admin-only diagnostic: runs a free-text query against the RAG knowledge
 * chunks (joined to their source) and returns the top-ranked matches with a
 * transparent relevance score. This is the "does retrieval actually surface
 * the right passage?" tool clinicians asked for — it lets an admin type a
 * question and see exactly which approved sources/chunks would ground an
 * answer, without going through the chat.
 *
 * Ranking is deterministic term-overlap (no embeddings column exists yet), so
 * the score breakdown is fully explainable in the UI. RLS still applies: the
 * request-scoped Supabase client only sees chunks the caller's role may read,
 * and we additionally filter to active+approved sources so the test reflects
 * what the live AI path would actually retrieve.
 *
 * Body: { query: string, limit?: number, activeOnly?: boolean }
 */

// Tokenization + term-overlap scoring live in the shared knowledgeChunking
// module so the admin diagnostic and the live retrieval path stay identical.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  const supabase = createSupabaseFromRequest(req);

  try {
    await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

    const body: any = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const limit = Math.min(Math.max(parseInt(String(body.limit ?? "10"), 10) || 10, 1), 50);
    const activeOnly = body.activeOnly !== false; // default true

    if (!query) {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const terms = tokenizeQuery(query);
    if (terms.length === 0) {
      return res.status(400).json({
        success: false,
        error: "query has no searchable terms (only stopwords / short tokens)",
      });
    }

    // Pull candidate chunks joined to their source. We over-fetch (bounded) and
    // rank in-process so the score breakdown is explainable. Postgres full-text
    // could pre-filter, but the corpus is small and this keeps behavior honest.
    let q = supabase
      .from("ans_knowledge_chunks")
      .select(
        `
          id, source_id, chunk_index, content, tokens, page, section,
          source:ans_knowledge_sources!inner (
            id, title, authors, year, publication_type, url,
            active_in_ai_analysis, review_status
          )
        `,
      )
      .limit(2000);

    if (activeOnly) {
      q = q
        .eq("source.active_in_ai_analysis", true)
        .eq("source.review_status", "approved");
    }

    const { data, error } = await q;
    if (error) throw error;

    const ranked = (data ?? [])
      .map((row: any) => {
        const { score, matched } = scoreChunk(row.content ?? "", terms);
        return { row, score, matched };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, score, matched }) => {
        const src = row.source ?? {};
        const content: string = row.content ?? "";
        // Snippet centered on the first matched term for context.
        const lower = content.toLowerCase();
        let anchor = 0;
        for (const m of matched) {
          const idx = lower.indexOf(m);
          if (idx >= 0) { anchor = idx; break; }
        }
        const start = Math.max(0, anchor - 120);
        const snippet =
          (start > 0 ? "…" : "") +
          content.slice(start, start + 320).trim() +
          (content.length > start + 320 ? "…" : "");
        return {
          chunkId: row.id,
          sourceId: row.source_id,
          chunkIndex: row.chunk_index,
          tokens: row.tokens ?? null,
          page: row.page ?? null,
          section: row.section ?? null,
          score,
          matchedTerms: matched,
          snippet,
          // A ready-to-render source/page citation label.
          citation:
            `${src.title ?? "(untitled)"}` +
            (src.year ? ` (${src.year})` : "") +
            (row.page != null ? `, p.${row.page}` : row.section ? `, ${row.section}` : ""),
          source: {
            id: src.id,
            title: src.title ?? "(untitled)",
            authors: src.authors ?? null,
            year: src.year ?? null,
            publicationType: src.publication_type ?? null,
            url: src.url ?? null,
            active: !!src.active_in_ai_analysis,
            reviewStatus: src.review_status ?? null,
          },
        };
      });

    return res.status(200).json({
      success: true,
      query,
      terms,
      activeOnly,
      candidatesScanned: (data ?? []).length,
      resultCount: ranked.length,
      results: ranked,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
