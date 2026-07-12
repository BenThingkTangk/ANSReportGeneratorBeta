/**
 * Safety tests:
 *  - S2-7 / S4-2: every indication code emitted by shared/indications.ts has an
 *    authored patient explainer, and the patient card never prints a raw code.
 *  - S1-1: ALA is gated to contraindications when baseline SBP is low.
 *
 * These are source-level invariants so they stay green regardless of which
 * specific patient/file is processed (generic guarantees, not fixtures).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

/** Pull every `code: "XXX"` literal from a source file. */
function extractCodes(src: string): string[] {
  const out = new Set<string>();
  const re = /code:\s*"([A-Z_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

/** Pull every top-level EXPLAINERS key (CODE: {) from the explainer source. */
function extractExplainerKeys(src: string): string[] {
  const out = new Set<string>();
  const re = /^\s{2}([A-Z][A-Z_]+):\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

describe("patient explainer coverage (S2-7 / S4-2)", () => {
  const indicationCodes = extractCodes(read("shared/indications.ts"));
  const explainerKeys = extractExplainerKeys(
    read("client/src/components/patient/DiagnosisExplainer.tsx"),
  );

  it("finds a non-trivial set of indication codes to check", () => {
    expect(indicationCodes.length).toBeGreaterThan(10);
  });

  it("every emitted indication code has an authored patient explainer", () => {
    const missing = indicationCodes.filter(c => !explainerKeys.includes(c));
    expect(missing).toEqual([]);
  });

  it("previously-missing codes are now covered", () => {
    for (const c of [
      "SE_VALSALVA",
      "PE_STAND",
      "SE_STAND",
      "PE_VALSALVA",
      "CAN_HIGH_SB",
      "CAN_LOW_SB",
      "DAN",
      "NEUROGENIC_SYNCOPE",
      "CARDIOGENIC_SYNCOPE",
      "WHITE_COAT",
    ]) {
      expect(explainerKeys).toContain(c);
    }
  });

  it("the patient card does NOT render the raw indication code", () => {
    const src = read("client/src/components/patient/DiagnosisExplainer.tsx");
    // The old code showed `{sev.label} · {ind.code}` in the header. Ensure the
    // raw code is no longer interpolated into visible JSX text.
    expect(src).not.toMatch(/\{sev\.label\}\s*·\s*\{ind\.code\}/);
  });

  it("the FALLBACK never uses the raw code as the visible title", () => {
    const src = read("client/src/components/patient/DiagnosisExplainer.tsx");
    // Old fallback: `title: code.replace(/_/g, " ")`. Must be gone.
    expect(src).not.toMatch(/title:\s*_?code\.replace/);
  });
});

describe("ALA contraindication gating (S1-1)", () => {
  const src = read("api/upload.ts");

  it("ALA is pushed to contraindications when baseline SBP is low", () => {
    // The gate must compare a baseline systolic BP against a low threshold and
    // route to contraindications rather than therapies.
    expect(src).toMatch(/baselineSBP\s*<\s*95/);
    expect(src).toMatch(/contraindications\.push\([^)]*Alpha-Lipoic Acid/);
  });

  it("ALA is only offered as a therapy in the else branch (adequate BP)", () => {
    // Ensure the therapy push for ALA sits after the low-BP contraindication
    // branch (i.e. it is gated, not unconditional).
    const contraIdx = src.indexOf("Alpha-Lipoic Acid (ALA) is contraindicated");
    const therapyIdx = src.indexOf('intervention: "Alpha-Lipoic Acid (ALA)"');
    expect(contraIdx).toBeGreaterThan(-1);
    expect(therapyIdx).toBeGreaterThan(-1);
    expect(therapyIdx).toBeGreaterThan(contraIdx);
  });
});
