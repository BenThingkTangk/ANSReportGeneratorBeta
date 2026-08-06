/**
 * Runtime regression coverage for the exact browser -> multipart endpoint.
 *
 * Complete PhysioPS files must use the stored six-phase vendor summary.
 * Waveform-only files must fall back to explicitly labelled ECG estimates
 * without fabricating blood pressure or vendor parity.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../../parse.ts";
import { parseStudy } from "../parseStudy.ts";
import { deriveEcgPhases } from "../ecgPhases.ts";
import { parseBinaryHeader, readEcgInt16 } from "../parseBinary.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORED_FIXTURE = path.join(__dirname, "fixtures", "jill_deid.ans");
const FALLBACK_FIXTURE = path.join(
  __dirname,
  "fixtures",
  "deidentified_waveform.ans",
);

function buildMultipart(fileBytes: Buffer, fileName: string) {
  const boundary = "----humanosTestBoundary1234567890";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="ansFile"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  return {
    body: Buffer.concat([head, fileBytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

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
    setImmediate(() => {
      const mid = Math.floor(body.length / 2);
      req.emit("data", body.subarray(0, mid));
      req.emit("data", body.subarray(mid));
      req.emit("end");
    });
  });
}

const canonicalBlocks = [
  "baseline",
  "deepBreathing",
  "valsalva",
  "standOrTilt",
] as const;

describe("POST /api/parse — stored PhysioPS summary", () => {
  it("returns all canonical phases with direct vendor provenance", async () => {
    const { status, json } = await invokeHandler(
      readFileSync(STORED_FIXTURE),
      "clinician-upload.ans",
    );

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const study = json.ansStudy;
    const codes = study.extractionWarnings.map((warning: any) => warning.code);
    expect(codes).toContain("PHASES_VENDOR_STORED");
    expect(codes).not.toContain("PHASES_ECG_DERIVED");

    for (const blockName of canonicalBlocks) {
      const block = study[blockName];
      expect(block.present, blockName).toBe(true);
      expect(block.heartRate.value, `${blockName} HR`).not.toBeNull();
      expect(block.heartRate.provenance.source).toBe("binary_float32");
      expect(block.heartRate.provenance.confidence).toBe(0.99);
      for (const key of ["lfa", "rfa", "sb"] as const) {
        expect(block[key].value, `${blockName} ${key}`).not.toBeNull();
        expect(block[key].provenance.source).toBe("binary_float32");
        expect(block[key].provenance.confidence).toBe(0.99);
      }
    }
  });

  it("recovers stored BP only in phases that contain a BP marker", async () => {
    const { json } = await invokeHandler(
      readFileSync(STORED_FIXTURE),
      "renamed-input.ans",
    );
    const study = json.ansStudy;

    expect(study.baseline.bp.sbp.value).toBe(92);
    expect(study.deepBreathing.bp.sbp.value).toBeNull();
    expect(study.valsalva.bp.sbp.value).toBe(95);
    expect(study.standOrTilt.bp.sbp.value).toBe(93);
    expect(study.baseline.bp.sbp.provenance.source).toBe("binary_uint8");
    expect(study.deepBreathing.bp.sbp.provenance.source).toBe("missing");
  });
});

describe("POST /api/parse — safe waveform fallback", () => {
  it("exposes all canonical phases with explicitly computed provenance", async () => {
    const { status, json } = await invokeHandler(
      readFileSync(FALLBACK_FIXTURE),
      "waveform-only.ans",
    );

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const study = json.ansStudy;
    const codes = study.extractionWarnings.map((warning: any) => warning.code);
    expect(codes).toContain("VENDOR_PHASE_SUMMARY_UNAVAILABLE");
    expect(codes).toContain("PHASES_ECG_DERIVED");

    for (const blockName of canonicalBlocks) {
      const block = study[blockName];
      expect(block.present, blockName).toBe(true);
      expect(block.heartRate.value, `${blockName} HR`).toBeGreaterThan(30);
      expect(block.heartRate.value, `${blockName} HR`).toBeLessThan(200);
      expect(block.heartRate.provenance.source).toBe("binary_int16");
      expect(block.bp.sbp.value, `${blockName} SBP`).toBeNull();
      expect(block.bp.dbp.value, `${blockName} DBP`).toBeNull();
      expect(block.bp.map.value, `${blockName} MAP`).toBeNull();

      for (const key of ["lfa", "rfa", "sb"] as const) {
        const field = block[key];
        if (field.value === null) {
          expect(field.provenance.source, `${blockName} ${key}`).toBe("missing");
        } else {
          expect(field.provenance.source, `${blockName} ${key}`).toBe("computed");
          expect(field.provenance.confidence).toBeGreaterThan(0);
          expect(field.provenance.confidence).toBeLessThan(1);
          expect((field.provenance.warnings ?? []).join(" ")).toMatch(
            /NOT a vendor-reported value|not validated against PhysioPS/i,
          );
        }
      }
    }
  });

  it("blocks unsupported BP-dependent diagnostic claims", async () => {
    const { json } = await invokeHandler(
      readFileSync(FALLBACK_FIXTURE),
      "waveform-only.ans",
    );
    const summary = json.diagnosticSummary;
    expect(summary).toBeTruthy();
    expect(summary.cardiovagalScore.assessable).toBe(true);
    const blockedClaims = (
      summary.unsafeOrUnsupportedClaimsBlocked ?? []
    ).map((blocked: any) => blocked.claim);
    expect(blockedClaims.some((claim: string) => /adrenergic/i.test(claim))).toBe(
      true,
    );
    expect(
      blockedClaims.some((claim: string) =>
        /orthostatic hypotension/i.test(claim),
      ),
    ).toBe(true);
  });

  it("does not mistake ratio prose for an ASCII Valsalva section", () => {
    const study = parseStudy({
      buffer: readFileSync(FALLBACK_FIXTURE),
      fileName: "waveform-only.ans",
    });
    expect(study.rawSections.map((section) => section.id)).not.toContain(
      "valsalva",
    );
  });

  it("uses six contiguous protocol windows that cover the recording", () => {
    const bytes = readFileSync(FALLBACK_FIXTURE);
    const binary = parseBinaryHeader(bytes);
    expect(binary.sampling).toBeTruthy();
    const ecg = readEcgInt16(bytes, binary.sampling!);
    const derived = deriveEcgPhases(ecg, binary.sampling!);
    expect(derived.timings).toHaveLength(6);
    for (let index = 1; index < derived.timings.length; index += 1) {
      expect(derived.timings[index].startSec).toBeCloseTo(
        derived.timings[index - 1].endSec,
        3,
      );
    }
    expect(derived.timings.at(-1)!.endSec).toBeCloseTo(derived.totalSec, 1);
  });
});
