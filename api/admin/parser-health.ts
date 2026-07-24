import type { VercelRequest, VercelResponse } from "@vercel/node";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { parseStudy } from "../_ans/parseStudy.js";
import { computeDiagnosticSummary } from "../_ans/scoring/index.js";
import { detectChunkSchema } from "../_ans/knowledgeSchema.js";
import { PARSER_VERSION } from "../../shared/ansStudy.js";
import {
  createSupabaseFromRequest,
  requireRole,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";

/**
 * GET /api/admin/parser-health
 *
 * One-call health board for the deterministic pipeline + AI model wiring:
 *   • parser: version + a live self-test (parse a fixture, time it, confirm
 *     phases/ratios come out) so an admin can see the engine is actually
 *     functioning, not just that the endpoint is up.
 *   • models: which AI integrations are CONFIGURED (env key present) vs not —
 *     never leaks the key, just a boolean + the voice id in use.
 *   • knowledge: source/chunk counts and how many are active+approved (i.e.
 *     actually reachable by retrieval).
 *   • evals: the last few regression-gate runs from eval/runs/history.jsonl.
 *
 * Read-only and role-gated. No PHI is returned.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET only" });

  const supabase = createSupabaseFromRequest(req);

  try {
    await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

    // ---- Parser self-test -------------------------------------------------
    // Parse the first available fixture end-to-end and confirm the pipeline
    // yields structured output. Failures are captured, not thrown, so the
    // board still renders with a red parser card.
    const parser: any = { version: PARSER_VERSION, ok: false };
    try {
      const fixturesDir = path.resolve(process.cwd(), "eval", "fixtures");
      const files = (await fs.readdir(fixturesDir)).filter((f) => f.endsWith(".json")).sort();
      if (files.length === 0) {
        parser.detail = "no fixtures available for self-test";
      } else {
        const raw = await fs.readFile(path.join(fixturesDir, files[0]), "utf8");
        const evalCase = JSON.parse(raw);
        const buf = Buffer.from(evalCase.ansBase64, "base64");
        const t0 = performance.now();
        const study = parseStudy({ buffer: buf, fileName: evalCase.fileName });
        const summary = computeDiagnosticSummary(study);
        const ms = Number((performance.now() - t0).toFixed(1));
        parser.ok = true;
        parser.selfTest = {
          fixture: evalCase.id ?? files[0],
          parseMs: ms,
          phaseCount: Array.isArray((study as any).phases) ? (study as any).phases.length : null,
          hasDiagnosticSummary: !!summary,
          warnings: Array.isArray((study as any).warnings) ? (study as any).warnings.length : 0,
        };
      }
    } catch (e: any) {
      parser.ok = false;
      parser.detail = e?.message ?? "parser self-test failed";
    }

    // ---- Model / integration configuration --------------------------------
    const models = {
      askAtom: {
        provider: "perplexity-sonar-pro",
        configured: Boolean(process.env.PPLX_API_KEY),
      },
      synopsis: {
        provider: "perplexity-sonar-pro",
        configured: Boolean(process.env.PPLX_API_KEY),
      },
      tts: {
        provider: "elevenlabs",
        voiceId: "gs0tAILXbY5DNrJrsM6F",
        model: "eleven_turbo_v2_5",
        configured: Boolean(process.env.ELEVENLABS_API_KEY),
        browserFallback: true,
      },
    };

    // ---- Knowledge base reachability --------------------------------------
    const knowledge: any = { ok: true };
    try {
      // Detect the chunk schema first so no count query references a column
      // that may not exist (legacy DB without migration 0005).
      const schema = await detectChunkSchema(supabase);
      const [{ count: sourceCount }, { count: activeCount }, { count: chunkCount }] =
        await Promise.all([
          supabase.from("ans_knowledge_sources").select("id", { count: "exact", head: true }),
          supabase
            .from("ans_knowledge_sources")
            .select("id", { count: "exact", head: true })
            .eq("active_in_ai_analysis", true)
            .eq("review_status", "approved"),
          supabase.from("ans_knowledge_chunks").select("id", { count: "exact", head: true }),
        ]);

      // Metadata-only placeholder chunks (section='metadata') are NOT full-text
      // RAG. Count them separately when the section column exists so health can
      // honestly distinguish "indexed from source documents" from "metadata
      // placeholders only". On the legacy schema we cannot tell them apart.
      let metadataChunks: number | null = null;
      if (schema.hasSection) {
        const { count } = await supabase
          .from("ans_knowledge_chunks")
          .select("id", { count: "exact", head: true })
          .eq("section", "metadata");
        metadataChunks = count ?? 0;
      }

      const total = chunkCount ?? 0;
      const fullTextChunks = metadataChunks == null ? null : Math.max(0, total - metadataChunks);

      knowledge.totalSources = sourceCount ?? 0;
      knowledge.activeApprovedSources = activeCount ?? 0;
      knowledge.totalChunks = total;
      knowledge.metadataOnlyChunks = metadataChunks;
      knowledge.fullTextChunks = fullTextChunks;
      knowledge.chunkSchemaVersion = schema.schemaVersion;
      knowledge.hasPageColumn = schema.hasPage;
      knowledge.hasSectionColumn = schema.hasSection;

      // Honest RAG status. Retrieval works when chunks exist, but metadata-only
      // placeholders are explicitly a WEAKER state than full-text ingestion.
      if (total === 0) {
        knowledge.ragFunctional = false;
        knowledge.ragStatus = (sourceCount ?? 0) > 0 ? "sources_present_no_chunks" : "empty";
        knowledge.activation =
          (sourceCount ?? 0) > 0
            ? "Sources exist but 0 chunks. Run POST /api/admin/knowledge/reindex (metadata chunks) or upload the source files (full text). See docs/RAG_ACTIVATION.md."
            : "No knowledge sources. Add + approve sources, then ingest.";
      } else if (fullTextChunks === 0) {
        // Chunks exist but all are metadata placeholders.
        knowledge.ragFunctional = false;
        knowledge.ragStatus = "metadata_only";
        knowledge.activation =
          "Only metadata placeholder chunks exist (title/abstract/claims). This is NOT full-text RAG. Upload the source documents via Admin → Upload PDF to ingest real passages. See docs/RAG_ACTIVATION.md.";
      } else {
        knowledge.ragFunctional = true;
        knowledge.ragStatus = metadataChunks && metadataChunks > 0 ? "indexed_mixed" : "indexed";
      }
    } catch (e: any) {
      knowledge.ok = false;
      knowledge.detail = e?.message ?? "knowledge count failed";
    }

    // ---- Recent eval runs -------------------------------------------------
    const evals: any = { recent: [] };
    try {
      const histPath = path.resolve(process.cwd(), "eval", "runs", "history.jsonl");
      const raw = await fs.readFile(histPath, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      evals.recent = lines
        .slice(-5)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .reverse();
      const last = evals.recent[0];
      evals.lastGatePassed = last ? last.failedCases === 0 && last.unsafeOverclaimCount === 0 : null;
    } catch {
      evals.detail = "no eval history available in this environment";
    }

    const healthy = parser.ok && knowledge.ok !== false;

    return res.status(200).json({
      success: true,
      healthy,
      generatedAt: new Date().toISOString(),
      parser,
      models,
      knowledge,
      evals,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
