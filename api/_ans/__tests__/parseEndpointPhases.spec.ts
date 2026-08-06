/**
 * FINAL-QA regression: drives the EXACT runtime endpoint the UI uses
 * (`POST /api/parse`) with a real multipart body and asserts that a raw ECG
 * `.ans` waveform file exposes all four clinical phase blocks with generically
 * computed heart rate — the defect being "SECTIONS DETECTED: 1 / missing 51,
 * only Valsalva present".
 *
 * The test invokes the handler's own multipart parser + parseStudy +
 * computeDiagnosticSummary (not a fixture shortcut), so it protects the real
 * browser->API integration path.
 *
 * Data source priority:
 *   1. The attached Jill file, if present on disk (full end-to-end proof).
 *   2. A de-identified, structurally faithful waveform fixture committed to the
 *      repo (deterministic, PHI-free) — always runs in CI.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../../parse.ts";
import { parseStudy } from "../parseStudy.ts";
import { deriveEcgPhases } from "../ecgPhases.ts";
import { parseBinaryHeader, readEcgInt16 } from "../parseBinary.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "deidentified_waveform.ans");
const REAL_JILL =
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";

/** Build a multipart/form-data body with a single `ansFile` part. */
function buildMultipart(fileBytes: Buffer, fileName: string) {
  const boundary = "----humanosTestBoundary1234567890";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="ansFile"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  const body = Buffer.concat([head, fileBytes, tail]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Minimal Vercel-style req/res doubles that stream the multipart body. */
function invokeHandler(fileBytes: Buffer, fileName: string): Promise<{
  status: number;
  json: any;
}> {
  const { body, contentType } = buildMultipart(fileBytes, fileName);
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = { "content-type": contentType };

  return new Promise((resolve, reject) => {
    const res: any = {
      _status: 200,
      status(code: number) {
        this._status = code;
        return this;
      },
      setHeader() {
        return this;
      },
      json(payload: any) {
        resolve({ status: this._status, json: payload });
        return this;
      },
      end() {
        resolve({ status: this._status, json: null });
        return this;
      },
    };

    handler(req, res).catch(reject);

    // Stream the body on next tick so the handler can attach listeners.
    setImmediate(() => {
      // chunk it to exercise the concat path
      const mid = Math.floor(body.length / 2);
      req.emit("data", body.subarray(0, mid));
      req.emit("data", body.subarray(mid));
      req.emit("end");
    });
  });
}

function pickDataFile(): { bytes: Buffer; name: string; isReal: boolean } {
  if (existsSync(REAL_JILL)) {
    return {
      bytes: readFileSync(REAL_JILL),
      name: "Shah-Jill-Fri-Sep-26-2025-2.ans",
      isReal: true,
    };
  }
  return {
    bytes: readFileSync(FIXTURE),
    name: "deidentified_waveform.ans",
    isReal: false,
  };
}

describe("POST /api/parse — ECG-derived phase detection (FINAL-QA regression)", () => {
  it("exposes all four clinical phases with computed HR via the real endpoint", async () => {
    const { bytes, name } = pickDataFile();
    const { status, json } = await invokeHandler(bytes, name);

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const study = json.ansStudy;

    // The core defect: every phase block must now be present.
    expect(study.baseline.present).toBe(true);
    expect(study.deepBreathing.present).toBe(true);
    expect(study.valsalva.present).toBe(true);
    expect(study.standOrTilt.present).toBe(true);

    // Heart rate must be generically COMPUTED from the ECG (never null here,
    // never from an ASCII table that doesn't exist in a raw waveform file).
    for (const block of ["baseline", "deepBreathing", "valsalva", "standOrTilt"]) {
      const hr = study[block].heartRate;
      expect(hr.value, `${block} HR`).not.toBeNull();
      expect(hr.value).toBeGreaterThan(30);
      expect(hr.value).toBeLessThan(200);
      expect(hr.provenance.source).toBe("binary_int16");
    }
  });

  it("labels waveform-derived spectral values as computed estimates and never fabricates per-phase BP", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const study = json.ansStudy;

    // LFa/RFa/SB may be ESTIMATED generically from the R-R series, but the
    // vendor's own aggregates use an undisclosed method: a value here must
    // therefore be `computed` with sub-unity confidence and an explicit
    // "not vendor-reported" warning — never presented as vendor data, never
    // substituted by identity/hash, never scaled by a patient-fitted constant.
    for (const block of ["baseline", "deepBreathing", "valsalva", "standOrTilt"]) {
      for (const key of ["lfa", "rfa", "sb"] as const) {
        const field = study[block][key];
        if (field.value === null) {
          expect(field.provenance.source, `${block} ${key}`).toBe("missing");
          continue;
        }
        expect(field.provenance.source, `${block} ${key}`).toBe("computed");
        expect(field.provenance.confidence).toBeGreaterThan(0);
        expect(field.provenance.confidence).toBeLessThan(1);
        expect((field.provenance.warnings ?? []).join(" ")).toMatch(
          /NOT a vendor-reported value|not validated against PhysioPS/i,
        );
      }
      // Per-phase BP is not stored in the .ans -> stays missing.
      expect(study[block].bp.sbp.value, `${block} SBP`).toBeNull();
      expect(study[block].bp.dbp.value, `${block} DBP`).toBeNull();
    }
  });

  it("emits honest ECG-derived provenance and preserves Ewing ratios", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const study = json.ansStudy;

    const codes = study.extractionWarnings.map((w: any) => w.code);
    expect(codes).toContain("PHASES_ECG_DERIVED");

    // Ratios come from ASCII prose and must still be extracted.
    expect(study.ratios.eiRatio.value).not.toBeNull();
    expect(study.ratios.valsalvaRatio.value).not.toBeNull();
    expect(study.ratios.thirtyFifteenRatio.value).not.toBeNull();
  });

  it("produces a safe diagnostic summary (no unsupported BP-dependent claims)", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const ds = json.diagnosticSummary;

    expect(ds).toBeTruthy();
    // Cardiovagal is assessable from the Ewing ratios.
    expect(ds.cardiovagalScore.assessable).toBe(true);
    // BP-dependent claims must be explicitly blocked, not asserted.
    const blockedClaims = (ds.unsafeOrUnsupportedClaimsBlocked ?? []).map(
      (b: any) => b.claim,
    );
    expect(
      blockedClaims.some((c: string) => /adrenergic/i.test(c)),
      "adrenergic must be blocked without BP",
    ).toBe(true);
    expect(
      blockedClaims.some((c: string) => /orthostatic hypotension/i.test(c)),
      "OH must be blocked without BP",
    ).toBe(true);
  });

  it("does not falsely detect a Valsalva ASCII section from the ratio prose line", async () => {
    // "Valsalva Ratio = 1.43" must NOT create a valsalva ASCII section.
    const { bytes, name } = pickDataFile();
    const study = parseStudy({ buffer: bytes, fileName: name });
    const asciiSectionIds = study.rawSections.map((s) => s.id);
    // Any 'valsalva' presence must come from ECG derivation, not an ASCII heading.
    expect(asciiSectionIds).not.toContain("valsalva");
  });

  it("segments the recording into six protocol windows generically", () => {
    const bytes = readFileSync(FIXTURE);
    const bin = parseBinaryHeader(bytes);
    expect(bin.sampling).toBeTruthy();
    const ecg = readEcgInt16(bytes, bin.sampling!);
    const derived = deriveEcgPhases(ecg, bin.sampling!);
    expect(derived.timings.length).toBe(6);
    // Windows are contiguous and cover the whole recording.
    for (let i = 1; i < derived.timings.length; i++) {
      expect(derived.timings[i].startSec).toBeCloseTo(
        derived.timings[i - 1].endSec,
        3,
      );
    }
    expect(derived.timings[derived.timings.length - 1].endSec).toBeCloseTo(
      derived.totalSec,
      1,
    );
  });
});
