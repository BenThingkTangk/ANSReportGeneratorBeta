import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";

/**
 * GET  /api/admin/knowledge — list knowledge sources with filters
 * POST /api/admin/knowledge — create a new source
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createSupabaseFromRequest(req);

  try {
    if (req.method === "GET") {
      await requireRole(supabase, ["super_admin", "clinical_admin", "reviewer"]);

      const {
        status,
        type,
        active,
        search,
        page = "1",
        limit = "50",
      } = req.query as Record<string, string>;

      let query = supabase
        .from("ans_knowledge_sources")
        .select(
          "id, title, authors, year, publication_type, journal, publisher, doi, url, abstract, key_claims, ans_metrics, tags, used_in, active_in_ai_analysis, active_in_report_citations, active_in_admin_review, review_status, file_path, file_mime, file_size_bytes, added_by, last_updated_by, created_at, updated_at",
          { count: "exact" }
        )
        .order("year", { ascending: false })
        .order("created_at", { ascending: false });

      if (status) query = query.eq("review_status", status);
      if (type) query = query.eq("publication_type", type);
      if (active === "true") query = query.eq("active_in_ai_analysis", true);
      if (active === "false") query = query.eq("active_in_ai_analysis", false);
      if (search) {
        query = query.or(
          `title.ilike.%${search}%,authors.ilike.%${search}%,abstract.ilike.%${search}%`
        );
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const from = (pageNum - 1) * limitNum;
      query = query.range(from, from + limitNum - 1);

      const { data, error, count } = await query;
      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      return res.status(200).json({
        success: true,
        data,
        meta: { total: count ?? 0, page: pageNum, limit: limitNum },
      });
    }

    if (req.method === "POST") {
      const user = await requireRole(supabase, ["super_admin", "clinical_admin"]);
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      if (!body?.title) {
        return res.status(400).json({ success: false, error: "title is required" });
      }

      const payload = {
        title: body.title,
        authors: body.authors ?? null,
        year: body.year ? parseInt(body.year, 10) : null,
        publication_type: body.publication_type ?? null,
        journal: body.journal ?? null,
        publisher: body.publisher ?? null,
        doi: body.doi ?? null,
        pubmed_id: body.pubmed_id ?? null,
        url: body.url ?? null,
        abstract: body.abstract ?? null,
        key_claims: body.key_claims ?? [],
        diagnostic_relevance: body.diagnostic_relevance ?? null,
        ans_metrics: body.ans_metrics ?? [],
        tags: body.tags ?? [],
        used_in: body.used_in ?? [],
        active_in_ai_analysis: body.active_in_ai_analysis ?? false,
        active_in_report_citations: body.active_in_report_citations ?? false,
        active_in_admin_review: body.active_in_admin_review ?? true,
        review_status: body.review_status ?? "draft",
        added_by: user.id,
        last_updated_by: user.id,
      };

      const { data, error } = await supabase
        .from("ans_knowledge_sources")
        .insert(payload)
        .select()
        .single();

      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      await logAudit(
        supabase,
        "create",
        "ans_knowledge_sources",
        data.id,
        null,
        data as Record<string, unknown>,
        req
      );

      return res.status(201).json({ success: true, data });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
