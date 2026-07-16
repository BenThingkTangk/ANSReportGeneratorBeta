import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import {
  ragQuery,
  withRagTransaction,
  recordRagVersion,
  logRagAudit,
  ragBackendError,
  SOURCE_COLUMNS,
} from "../_ragDb.js";
import { invalidateKnowledgeCaches } from "../_knowledgeInvalidate.js";

/**
 * GET  /api/admin/knowledge — list knowledge sources with filters
 * POST /api/admin/knowledge — create a new source
 *
 * Backed by the dedicated Akamai Managed PostgreSQL instance (humanos-ans-rag-pg)
 * via the `pg` pool in ../_ragDb — NOT Supabase REST. Authorization is enforced
 * FIRST via the admin gateway session (requireRole → super_admin), before the
 * database is touched, so an unauthenticated caller can never probe backend
 * state. All SQL is parameterized.
 */

/** Escape LIKE/ILIKE metacharacters so user search text is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      // Authorize FIRST (gateway session cookie → super_admin; no Supabase user
      // session is consulted), THEN touch the backend.
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

      const {
        status,
        type,
        active,
        search,
        page = "1",
        limit = "50",
      } = req.query as Record<string, string>;

      const conds: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      if (status) {
        conds.push(`review_status = $${i++}`);
        params.push(status);
      }
      if (type) {
        conds.push(`publication_type = $${i++}`);
        params.push(type);
      }
      if (active === "true") {
        conds.push(`active_in_ai_analysis = $${i++}`);
        params.push(true);
      } else if (active === "false") {
        conds.push(`active_in_ai_analysis = $${i++}`);
        params.push(false);
      }
      if (search) {
        conds.push(
          `(title ILIKE $${i} OR authors ILIKE $${i} OR abstract ILIKE $${i})`
        );
        params.push(`%${escapeLike(search)}%`);
        i++;
      }

      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const from = (pageNum - 1) * limitNum;

      const limitPh = i++;
      params.push(limitNum);
      const offsetPh = i++;
      params.push(from);

      // count(*) OVER() returns the full filtered total alongside the page rows
      // in a single round trip (mirrors Supabase's count:"exact").
      const sql = `SELECT ${SOURCE_COLUMNS}, count(*) OVER() AS total_count
        FROM public.ans_knowledge_sources
        ${where}
        ORDER BY year DESC NULLS LAST, created_at DESC
        LIMIT $${limitPh} OFFSET $${offsetPh}`;

      let rows: Array<Record<string, unknown>>;
      try {
        const result = await ragQuery(sql, params);
        rows = result.rows;
      } catch (dbErr) {
        // Transport/connectivity → 503 (secret-free); schema missing → 503 with
        // a "run the migration" hint; a genuine query error → 400. Never a raw
        // driver TypeError.
        throw ragBackendError(dbErr);
      }

      const total = rows.length ? Number(rows[0].total_count) : 0;
      const data = rows.map(({ total_count, ...rest }) => rest);

      return res.status(200).json({
        success: true,
        data,
        meta: { total, page: pageNum, limit: limitNum },
      });
    }

    if (req.method === "POST") {
      const user = await requireRole(req, ["super_admin", "clinical_admin"]);
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      if (!body?.title) {
        return res.status(400).json({ success: false, error: "title is required" });
      }

      const values = [
        body.title,
        body.authors ?? null,
        body.year ? parseInt(String(body.year), 10) : null,
        body.publication_type ?? null,
        body.journal ?? null,
        body.publisher ?? null,
        body.doi ?? null,
        body.pubmed_id ?? null,
        body.url ?? null,
        body.abstract ?? null,
        JSON.stringify(body.key_claims ?? []), // jsonb
        body.diagnostic_relevance ?? null,
        asArray(body.ans_metrics), // text[]
        asArray(body.tags), // text[]
        asArray(body.used_in), // text[]
        body.active_in_ai_analysis ?? false,
        body.active_in_report_citations ?? false,
        body.active_in_admin_review ?? true,
        body.review_status ?? "draft",
        user.id,
        user.id,
      ];

      let created: Record<string, unknown>;
      try {
        created = await withRagTransaction(async (client) => {
          const insertRes = await client.query(
            `INSERT INTO public.ans_knowledge_sources
               (title, authors, year, publication_type, journal, publisher, doi, pubmed_id, url,
                abstract, key_claims, diagnostic_relevance, ans_metrics, tags, used_in,
                active_in_ai_analysis, active_in_report_citations, active_in_admin_review,
                review_status, added_by, last_updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
             RETURNING ${SOURCE_COLUMNS}`,
            values
          );
          const row = insertRes.rows[0] as Record<string, unknown>;
          await recordRagVersion(client, row.id as string, "create", row, {
            id: user.id,
            email: user.email,
          });
          return row;
        });
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      await logRagAudit(
        "create",
        "ans_knowledge_sources",
        created.id as string,
        null,
        created,
        { id: user.id, email: user.email },
        req
      );

      // A newly-created source may be active+approved (e.g. imported) — refresh
      // the AI read-path caches so it is discoverable without waiting for TTL.
      invalidateKnowledgeCaches();

      return res.status(201).json({ success: true, data: created });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
