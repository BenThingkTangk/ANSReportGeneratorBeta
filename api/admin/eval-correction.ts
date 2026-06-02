import type { VercelRequest, VercelResponse } from "@vercel/node";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createSupabaseAdmin,
  requireRole,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";
import type { ClinicianCorrection } from "../../shared/evalTypes.js";

/**
 * POST /api/admin/eval-correction
 *
 * Body: { caseId?, reportRef?, engineOutput, correctedFields?, correctedScores?,
 *         correctedFlags?, notes?, promoteToFixture? }
 *
 * Persists a clinician correction:
 *   1. Always appends to `eval/corrections/corrections.jsonl` (local-first
 *      durable store — every correction becomes usable as a future eval case).
 *   2. When Supabase env is configured, also upserts to ans_clinician_corrections.
 *
 * Returns the saved correction id. The admin Accuracy Lab UI can then call
 * the eval runner to verify the fix.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  try {
    const user = await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);
    const body = (req.body ?? {}) as Partial<ClinicianCorrection> & {
      promoteToFixture?: boolean;
    };
    if (!body.engineOutput) {
      return res.status(400).json({
        success: false,
        error: "engineOutput is required (a copy of the DiagnosticSummary)",
      });
    }
    if (!body.caseId && !body.reportRef) {
      return res.status(400).json({
        success: false,
        error: "either caseId or reportRef must be set",
      });
    }

    const correction: ClinicianCorrection = {
      id: randomUUID(),
      caseId: body.caseId,
      reportRef: body.reportRef,
      clinicianEmail: user.email,
      engineOutput: body.engineOutput,
      correctedFields: body.correctedFields,
      correctedScores: body.correctedScores,
      correctedFlags: body.correctedFlags,
      notes: body.notes,
      createdAt: new Date().toISOString(),
      promotedToFixture: false,
    };

    // 1. Local-first append to JSONL — never throws even if DB unavailable.
    const correctionsDir = path.resolve(process.cwd(), "eval", "corrections");
    try {
      await fs.mkdir(correctionsDir, { recursive: true });
      await fs.appendFile(
        path.join(correctionsDir, "corrections.jsonl"),
        JSON.stringify(correction) + "\n",
        "utf8",
      );
    } catch (e) {
      // Filesystem may be read-only in some serverless runtimes — log + continue.
      console.warn("[eval-correction] could not persist to JSONL:", e);
    }

    // 2. Optional Supabase persistence.
    let supabasePersisted = false;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const supabase = createSupabaseAdmin();
        const { error } = await supabase.from("ans_clinician_corrections").upsert({
          id: correction.id,
          case_id: correction.caseId ?? null,
          report_ref: correction.reportRef ?? null,
          clinician_email: correction.clinicianEmail,
          engine_output: correction.engineOutput,
          corrected_fields: correction.correctedFields ?? null,
          corrected_scores: correction.correctedScores ?? null,
          corrected_flags: correction.correctedFlags ?? null,
          notes: correction.notes ?? null,
          promoted_to_fixture: correction.promotedToFixture,
          created_at: correction.createdAt,
        });
        if (!error) supabasePersisted = true;
        else console.warn("[eval-correction] supabase upsert failed:", error.message);
      } catch (e) {
        console.warn("[eval-correction] supabase upsert exception:", e);
      }
    }

    // 3. Optional "promote to fixture" — write a new fixture JSON if requested.
    let promotedCaseId: string | undefined;
    if (body.promoteToFixture && body.caseId) {
      const fixturesDir = path.resolve(process.cwd(), "eval", "fixtures");
      try {
        const sourcePath = path.join(fixturesDir, `${body.caseId}.json`);
        const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
        const newId = `correction-${Date.now()}-${body.caseId}`;
        const promoted = {
          ...source,
          id: newId,
          source: "clinician_correction",
          description: `Promoted from clinician correction (${user.email}). Original: ${body.caseId}`,
          expectedFields: body.correctedFields ?? source.expectedFields,
          expectedScores: body.correctedScores ?? source.expectedScores,
          expectedFlags: body.correctedFlags ?? source.expectedFlags,
          clinicianNotes: body.notes ?? source.clinicianNotes,
          createdAt: new Date().toISOString(),
        };
        await fs.writeFile(
          path.join(fixturesDir, `${newId}.json`),
          JSON.stringify(promoted, null, 2) + "\n",
        );
        promotedCaseId = newId;
      } catch (e) {
        console.warn("[eval-correction] promote failed:", e);
      }
    }

    return res.json({
      success: true,
      data: {
        id: correction.id,
        supabasePersisted,
        promotedCaseId,
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}
