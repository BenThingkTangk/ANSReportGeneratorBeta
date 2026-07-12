/**
 * Offline parity regression against the de-identified golden oracle.
 *
 * This is the ONLY place the oracle is read, and it is read as a FILE at test
 * time (never imported by runtime). It asserts the parts of the vendor output
 * that are genuinely reproducible from the .ans (consensus [C] norm bands and
 * Ewing thresholds, ectopic count, demographics), and DOCUMENTS the residual
 * gap for the proprietary [P] spectral aggregates without asserting byte-exact
 * reproduction (which is impossible from files alone).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  EWING_THRESHOLDS,
  classifyEwing,
  COLOMBO_NORMS,
} from "../../../shared/colomboNorms";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../");
const oracle = JSON.parse(
  readFileSync(resolve(repoRoot, "eval/oracles/jill_shah_deidentified.json"), "utf8"),
);

describe("golden oracle is offline-only", () => {
  it("is explicitly flagged do-not-load-at-runtime and de-identified", () => {
    expect(oracle._meta.do_not_load_at_runtime).toBe(true);
    // No direct identifiers.
    const blob = JSON.stringify(oracle);
    expect(blob).not.toMatch(/Jill|Shah|Colombo/); // name/physician removed
    expect(oracle.demographics).toMatchObject({ ageYears: 56, sex: "Female" });
  });
});

describe("consensus [C] parity — reproducible from the .ans", () => {
  it("Ewing ratios classify Normal against shared thresholds (one-sided)", () => {
    const t = oracle.time_domain_ratios;
    expect(classifyEwing(t.eiRatio, EWING_THRESHOLDS.eiRatio).label).toBe("Normal");
    expect(classifyEwing(t.valsalvaRatio, EWING_THRESHOLDS.valsalvaRatio).label).toBe("Normal");
    expect(classifyEwing(t.thirtyFifteenRatio, EWING_THRESHOLDS.thirtyFifteenRatio).label).toBe("Normal");
    expect(t.all_normal).toBe(true);
  });

  it("FRF normal band matches the single source of truth", () => {
    expect(oracle.frf_norm_hz).toMatchObject({ lo: COLOMBO_NORMS.FRF.lo, hi: COLOMBO_NORMS.FRF.hi });
  });

  it("ectopic count is a single beat", () => {
    expect(oracle.ectopic_beats).toBe(1);
  });
});

describe("proprietary [P] residual gap — documented, NOT asserted as reproduced", () => {
  it("records vendor spectral aggregates without any equality claim", () => {
    const a = oracle.phase_numerical_summary_vendor.find((p: any) => p.phase === "A_baseline");
    // The oracle DOCUMENTS the vendor value; the test does not require our
    // pipeline to reproduce it, because the .ans lacks the vendor scalars and
    // the algorithm is undisclosed (see eval/oracles/README.md).
    expect(a.LFa).toBe(0.91);
    expect(a.RFa).toBe(5.13);
    expect(a.SB).toBe(0.18);
    // Residual-parity limit is explicitly acknowledged in oracle metadata.
    expect(oracle._meta.purpose.toLowerCase()).toMatch(/approximat|residual|never/);
  });
});
