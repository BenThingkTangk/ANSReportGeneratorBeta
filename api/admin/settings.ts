import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import { ragQuery, logRagAudit, ragBackendError } from "../_ragDb.js";
import { invalidateKnowledgeCaches } from "../_knowledgeInvalidate.js";

/**
 * /api/admin/settings
 *
 * GET                — read feature flags (reviewer/admin — gateway session).
 * PUT { key, value } — super_admin only.
 *
 * Backed by Akamai Managed PostgreSQL (humanos-ans-rag-pg) via ../_ragDb — the
 * SAME store isEvidenceEnabled() reads — NOT Supabase, so toggling the master
 * flag takes effect on the AI read path (after cache invalidation) with no
 * split-brain. Auth is enforced FIRST via the admin gateway session; every
 * statement is parameterized. `value` is jsonb — pg returns it parsed and writes
 * require JSON.stringify + ::jsonb.
 *
 * Currently exposes a single key (evidence_linked_explanations_enabled) plus
 * any other rows present in app_settings.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      // Reading admin flags requires a reviewer+ gateway session (the admin page
      // authenticates as super_admin via the gateway cookie).
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

      let rows: Array<{
        key: string;
        value: unknown;
        description: string | null;
        updated_at: string;
      }>;
      try {
        const result = await ragQuery<{
          key: string;
          value: unknown;
          description: string | null;
          updated_at: string;
        }>(
          "SELECT key, value, description, updated_at FROM public.app_settings ORDER BY key ASC"
        );
        rows = result.rows;
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      // Convert to convenient map form for the client (value is already parsed).
      const map: Record<string, unknown> = {};
      for (const row of rows) map[row.key] = row.value;
      return res.status(200).json({ success: true, data: { settings: rows, map } });
    }

    if (req.method === "PUT") {
      const user = await requireRole(req, ["super_admin"]);
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const key = body?.key;
      const value = body?.value;
      if (!key || value === undefined) {
        return res
          .status(400)
          .json({ success: false, error: "key and value required" });
      }

      let before: Record<string, unknown> | null;
      let updated: Record<string, unknown>;
      try {
        const cur = await ragQuery(
          "SELECT key, value, description, updated_by, updated_at FROM public.app_settings WHERE key = $1",
          [key]
        );
        before = (cur.rows[0] as Record<string, unknown>) ?? null;

        const upd = await ragQuery(
          `INSERT INTO public.app_settings (key, value, updated_by)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by
           RETURNING key, value, description, updated_by, updated_at`,
          [key, JSON.stringify(value), user.id]
        );
        updated = upd.rows[0] as Record<string, unknown>;
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      await logRagAudit(
        "settings.update",
        "app_settings",
        key,
        before,
        updated,
        { id: user.id, email: user.email },
        req
      );
      // The evidence master toggle is read on the AI path — refresh caches so
      // enabling/disabling citations takes effect immediately on this instance.
      invalidateKnowledgeCaches();
      return res.status(200).json({ success: true, data: updated });
    }

    return res.status(405).json({ success: false, error: "method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
