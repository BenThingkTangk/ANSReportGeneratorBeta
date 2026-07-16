import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import { ragQuery, ragBackendError } from "../_ragDb.js";

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
 * the score breakdown is fully explainable in the UI. It reads the AUTHORITATIVE
 * Akamai PostgreSQL store (humanos-ans-rag-pg) via ../_ragDb — the SAME store
 * the live AI path retrieves from — and filters to active+approved sources so
 * the test reflects exactly what real report grounding would surface.
 *
 * Body: { query: string, limit?: number, activeOnly?: boolean }
 */

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "and", "or", "is", "are", "for", "on",
  "with", "as", "by", "at", "be", "this", "that", "it", "from", "what", "how",
  "why", "when", "which", "does", "do", "can", "should", "my", "i",
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t),
  );
}

/** Transparent term-overlap score: sum of per-term frequency in the chunk,
 *  normalized by chunk length, with a bonus for the count of distinct terms
 *  matched (breadth beats a single repeated word). */
function scoreChunk(content: string, terms: string[]): { score: number; matched: string[] } {
  const text = content.toLowerCase();
  const words = text.match(/[a-z0-9]+/g) ?? [];
  const total = Math.max(words.length, 1);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  const matched: string[] = [];
  let freqScore = 0;
  for (const term of terms) {
    const c = counts.get(term) ?? 0;
    if (c > 0) {
      matched.push(term);
      freqScore += c;
    }
  }
  if (matched.length === 0) return { score: 0, matched };
  const density = freqScore / total;
  const breadth = matched.length / terms.length;
  // Weight breadth heavily so a chunk touching many query terms ranks above one
  // that merely repeats a single term.
  const score = Number((breadth * 0.7 + density * 100 * 0.3).toFixed(4));
  return { score, matched };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

    const body: any = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const limit = Math.min(Math.max(parseInt(String(body.limit ?? "10"), 10) || 10, 1), 50);
    const activeOnly = body.activeOnly !== false; // default true

    if (!query) {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const terms = tokenize(query);
    if (terms.length === 0) {
      return res.status(400).json({
        success: false,
        error: "query has no searchable terms (only stopwords / short tokens)",
      });
    }

    // Pull candidate chunks joined to their source. We over-fetch (bounded) and
    // rank in-process so the score breakdown is explainable. Postgres full-text
    // could pre-filter, but the corpus is small and this keeps behavior honest.
    // json_build_object nests the source so the mapping below is unchanged.
    let data: Array<Record<string, any>>;
    try {
      const result = await ragQuery<Record<string, any>>(
        `SELECT c.id, c.source_id, c.chunk_index, c.content, c.tokens,
                json_build_object(
                  'id', s.id,
                  'title', s.title,
                  'authors', s.authors,
                  'year', s.year,
                  'publication_type', s.publication_type,
                  'active_in_ai_analysis', s.active_in_ai_analysis,
                  'review_status', s.review_status
                ) AS source
           FROM public.ans_knowledge_chunks c
           JOIN public.ans_knowledge_sources s ON s.id = c.source_id
          ${activeOnly ? "WHERE s.active_in_ai_analysis = true AND s.review_status = 'approved'" : ""}
          LIMIT 2000`
      );
      data = result.rows;
    } catch (dbErr) {
      throw ragBackendError(dbErr);
    }

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
          score,
          matchedTerms: matched,
          snippet,
          source: {
            id: src.id,
            title: src.title ?? "(untitled)",
            authors: src.authors ?? null,
            year: src.year ?? null,
            publicationType: src.publication_type ?? null,
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
