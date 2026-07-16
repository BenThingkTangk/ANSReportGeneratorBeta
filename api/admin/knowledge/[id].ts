import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole, setCorsHeaders, handleError } from "../../_supabase.js";
import {
  ragQuery,
  withRagTransaction,
  recordRagVersion,
  logRagAudit,
  ragBackendError,
  SOURCE_COLUMNS,
  type RagChangeAction,
} from "../../_ragDb.js";
import { invalidateKnowledgeCaches } from "../../_knowledgeInvalidate.js";

/**
 * GET    /api/admin/knowledge/:id — get single source + chunk summary + versions
 * PUT    /api/admin/knowledge/:id — update source (also activate/archive)
 * DELETE /api/admin/knowledge/:id — delete (super_admin only)
 *
 * Backed by Akamai Managed PostgreSQL (humanos-ans-rag-pg) via ../../_ragDb —
 * NOT Supabase REST. Auth is enforced FIRST via the admin gateway session.
 * Every statement is parameterized.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ success: false, error: "id is required" });
  // A non-uuid id can never match a row; treat as not found (never a 500).
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ success: false, error: "Not found" });
  }

  try {
    if (req.method === "GET") {
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

      let source: Record<string, unknown> | undefined;
      let chunkCount = 0;
      let chunks: Array<Record<string, unknown>> = [];
      let versions: Array<Record<string, unknown>> = [];
      try {
        const srcRes = await ragQuery(
          `SELECT ${SOURCE_COLUMNS} FROM public.ans_knowledge_sources WHERE id = $1`,
          [id]
        );
        source = srcRes.rows[0];
        if (!source) {
          return res.status(404).json({ success: false, error: "Not found" });
        }

        const [countRes, chunkRes, verRes] = await Promise.all([
          ragQuery<{ n: number }>(
            "SELECT count(*)::int AS n FROM public.ans_knowledge_chunks WHERE source_id = $1",
            [id]
          ),
          ragQuery<{ id: string; chunk_index: number; tokens: number | null; content: string }>(
            `SELECT id, chunk_index, tokens, content
               FROM public.ans_knowledge_chunks
              WHERE source_id = $1
              ORDER BY chunk_index ASC
              LIMIT 200`,
            [id]
          ),
          ragQuery(
            `SELECT version, change_action, changed_by_email, created_at
               FROM public.ans_knowledge_versions
              WHERE source_id = $1
              ORDER BY version DESC
              LIMIT 20`,
            [id]
          ),
        ]);

        chunkCount = countRes.rows[0]?.n ?? 0;
        chunks = chunkRes.rows.map((c) => ({
          id: c.id,
          chunkIndex: c.chunk_index,
          tokens: c.tokens ?? null,
          // Preview only — keeps payloads small while making chunks browseable.
          preview: typeof c.content === "string" ? c.content.slice(0, 600) : "",
          length: typeof c.content === "string" ? c.content.length : 0,
        }));
        versions = verRes.rows;
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      return res.status(200).json({
        success: true,
        data: { ...source, chunkCount, chunks, versions },
      });
    }

    if (req.method === "PUT") {
      const user = await requireRole(req, [
        "super_admin",
        "clinical_admin",
        "reviewer",
      ]);
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      // Only super_admin/clinical_admin can toggle active_in_ai_analysis.
      const allowedToToggleAI = ["super_admin", "clinical_admin"].includes(user.role);

      // Build a parameterized SET list from whitelisted fields only.
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      const setField = (col: string, value: unknown, cast = "") => {
        sets.push(`${col} = $${i}${cast}`);
        params.push(value);
        i++;
      };

      const scalarFields = [
        "title",
        "authors",
        "year",
        "publication_type",
        "journal",
        "publisher",
        "doi",
        "pubmed_id",
        "url",
        "abstract",
        "diagnostic_relevance",
        "active_in_report_citations",
        "active_in_admin_review",
        "review_status",
        "file_path",
        "file_mime",
        "file_size_bytes",
      ];
      for (const f of scalarFields) {
        if (f in body) {
          let v = body[f];
          if (f === "year") v = body.year != null ? parseInt(String(body.year), 10) : null;
          if (f === "file_size_bytes")
            v = body.file_size_bytes != null ? parseInt(String(body.file_size_bytes), 10) : null;
          setField(f, v ?? null);
        }
      }
      if ("key_claims" in body) setField("key_claims", JSON.stringify(body.key_claims ?? []), "::jsonb");
      for (const f of ["ans_metrics", "tags", "used_in"]) {
        if (f in body) setField(f, asArray(body[f]));
      }
      if (allowedToToggleAI && "active_in_ai_analysis" in body) {
        setField("active_in_ai_analysis", Boolean(body.active_in_ai_analysis));
      }
      // Always stamp the editor (id is null in gateway mode).
      setField("last_updated_by", user.id);

      const idPh = i;
      params.push(id);

      let existing: Record<string, unknown> | undefined;
      let updated: Record<string, unknown> | undefined;
      try {
        updated = await withRagTransaction(async (client) => {
          const cur = await client.query(
            `SELECT ${SOURCE_COLUMNS} FROM public.ans_knowledge_sources WHERE id = $1 FOR UPDATE`,
            [id]
          );
          existing = cur.rows[0] as Record<string, unknown> | undefined;
          if (!existing) return undefined;

          const upd = await client.query(
            `UPDATE public.ans_knowledge_sources SET ${sets.join(", ")} WHERE id = $${idPh} RETURNING ${SOURCE_COLUMNS}`,
            params
          );
          const row = upd.rows[0] as Record<string, unknown>;

          // Precise version action for the immutable history.
          let action: RagChangeAction = "update";
          if (body.review_status === "archived" && existing.review_status !== "archived") {
            action = "archive";
          } else if (
            allowedToToggleAI &&
            body.active_in_ai_analysis === true &&
            existing.active_in_ai_analysis === false
          ) {
            action = "activate";
          }
          await recordRagVersion(client, id, action, row, { id: user.id, email: user.email });
          return row;
        });
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      if (!updated) {
        return res.status(404).json({ success: false, error: "Not found" });
      }

      await logRagAudit(
        "update",
        "ans_knowledge_sources",
        id,
        existing ?? null,
        updated,
        { id: user.id, email: user.email },
        req
      );

      // Activation/archival/edits change what the AI may cite — refresh caches.
      invalidateKnowledgeCaches();

      return res.status(200).json({ success: true, data: updated });
    }

    if (req.method === "DELETE") {
      const user = await requireRole(req, ["super_admin"]);

      let existing: Record<string, unknown> | undefined;
      try {
        const del = await withRagTransaction(async (client) => {
          const cur = await client.query(
            `SELECT ${SOURCE_COLUMNS} FROM public.ans_knowledge_sources WHERE id = $1 FOR UPDATE`,
            [id]
          );
          existing = cur.rows[0] as Record<string, unknown> | undefined;
          if (!existing) return false;
          // chunks + versions cascade via ON DELETE CASCADE.
          await client.query("DELETE FROM public.ans_knowledge_sources WHERE id = $1", [id]);
          return true;
        });
        if (!del) {
          return res.status(404).json({ success: false, error: "Not found" });
        }
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      await logRagAudit(
        "delete",
        "ans_knowledge_sources",
        id,
        existing ?? null,
        null,
        { id: user.id, email: user.email },
        req
      );

      // A deleted source (and its cascaded links) must drop out of the AI path.
      invalidateKnowledgeCaches();

      return res.status(200).json({ success: true, deleted: id });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
