/**
 * Experimental sequential LabVIEW cluster decoder — safety + behavior tests.
 *
 * Contract under test:
 *   - OFF by default; only runs when HUMANOS_EXPERIMENTAL_CLUSTER_DECODER is set.
 *   - Bounds-checked; reports full-buffer consumption.
 *   - Recovered spectral values are tagged vendor_reported + experimental and are
 *     NEVER returned inside an AnsStudy / never feed scoring.
 *   - Differential diagnostics: validation only passes on a genuine matched-pair
 *     match; no universal-parity claim.
 *
 * No patient data — synthetic buffers only. The one real fixture used
 * (deidentified_waveform.ans) is already de-identified in the repo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  isClusterDecoderEnabled,
  detectEndian,
  decodeClusterExperimental,
  compareWithReference,
  type ClusterDecodeResult,
} from "../experimentalClusterDecoder.js";

const ON = { HUMANOS_EXPERIMENTAL_CLUSTER_DECODER: "1" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;

/** Build a synthetic BE LabVIEW-ish cluster: two LP-strings then N doubles. */
function synthCluster(strings: string[], doubles: number[]): Buffer {
  const parts: Buffer[] = [];
  for (const s of strings) {
    const body = Buffer.from(s, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    parts.push(len, body);
  }
  for (const d of doubles) {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(d, 0);
    parts.push(b);
  }
  return Buffer.concat(parts);
}

describe("experimental cluster decoder — feature flag", () => {
  it("is OFF by default", () => {
    expect(isClusterDecoderEnabled(OFF)).toBe(false);
    expect(isClusterDecoderEnabled({ HUMANOS_EXPERIMENTAL_CLUSTER_DECODER: "0" } as any)).toBe(false);
  });
  it("is ON only for explicit truthy values", () => {
    expect(isClusterDecoderEnabled(ON)).toBe(true);
    expect(isClusterDecoderEnabled({ HUMANOS_EXPERIMENTAL_CLUSTER_DECODER: "true" } as any)).toBe(true);
    expect(isClusterDecoderEnabled({ HUMANOS_EXPERIMENTAL_CLUSTER_DECODER: "on" } as any)).toBe(true);
  });
  it("returns a disabled result and decodes nothing when off", () => {
    const buf = synthCluster(["Doe", "Jane"], [1.1, 2.2, 3.3]);
    const r = decodeClusterExperimental(buf, OFF);
    expect(r.enabled).toBe(false);
    expect(r.spectral).toHaveLength(0);
    expect(r.strings).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/disabled/i);
  });
});

describe("experimental cluster decoder — decode + integrity", () => {
  it("autodetects big-endian from a leading small length word", () => {
    const buf = synthCluster(["AB"], []);
    expect(detectEndian(buf)).toBe("BE");
  });

  it("recovers ordered strings and consumes the whole buffer", () => {
    const buf = synthCluster(["Doe", "Jane", "Female"], [10, 5, 2, 8, 3, 2.6]);
    const r = decodeClusterExperimental(buf, ON);
    expect(r.enabled).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.strings.map((s) => s.value)).toEqual(["Doe", "Jane", "Female"]);
    expect(r.fullyConsumed).toBe(true);
    expect(r.consumedBytes).toBe(r.bufferBytes);
  });

  it("tags every recovered spectral value vendor_reported + experimental", () => {
    const buf = synthCluster(["Doe"], [10, 5, 2, 8, 3, 2.6]);
    const r = decodeClusterExperimental(buf, ON);
    expect(r.spectral.length).toBeGreaterThan(0);
    for (const s of r.spectral) {
      expect(s.provenance).toBe("vendor_reported");
      expect(s.experimental).toBe(true);
    }
  });

  it("never returns an AnsStudy shape (cannot be fed to scoring)", () => {
    const buf = synthCluster(["Doe"], [10, 5, 2]);
    const r = decodeClusterExperimental(buf, ON) as unknown as Record<string, unknown>;
    // Guard: the result must not carry AnsStudy hallmark keys.
    expect(r.sympatheticParasympathetic).toBeUndefined();
    expect(r.baseline).toBeUndefined();
    expect(r.schemaVersion).toBeUndefined();
  });

  it("is bounds-safe on a truncated buffer (no throw to caller)", () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x05, 0x41]); // len=5 but only 1 body byte
    const r = decodeClusterExperimental(buf, ON);
    expect(r.enabled).toBe(true);
    // It should stop gracefully and report partial consumption.
    expect(r.consumedBytes).toBeLessThanOrEqual(r.bufferBytes);
  });
});

describe("experimental cluster decoder — differential diagnostics", () => {
  it("validationPassed is TRUE only on a genuine matched-pair match within tolerance", () => {
    // Craft doubles so positional triples map to clean A/B values.
    const buf = synthCluster(["Doe"], [10, 5, 999, 8, 4, 999, 6, 3, 999, 7, 2, 999, 9, 3, 999, 12, 6, 999]);
    const r = decodeClusterExperimental(buf, ON);
    const reference = r.spectral.map((s) => ({ label: s.label, lfa: s.lfa!, rfa: s.rfa! }));
    const diff = compareWithReference(r, reference, { pctTolerance: 1, minFields: 6 });
    expect(diff.comparedFields).toBeGreaterThanOrEqual(6);
    expect(diff.validationPassed).toBe(true);
    expect(diff.matchRate).toBe(1);
  });

  it("validationPassed is FALSE when recovered values diverge from the reference", () => {
    const buf = synthCluster(["Doe"], [10, 5, 999, 8, 4, 999, 6, 3, 999, 7, 2, 999, 9, 3, 999, 12, 6, 999]);
    const r = decodeClusterExperimental(buf, ON);
    const wrongRef = r.spectral.map((s) => ({ label: s.label, lfa: (s.lfa ?? 0) + 50, rfa: (s.rfa ?? 0) + 50 }));
    const diff = compareWithReference(r, wrongRef, { pctTolerance: 1, minFields: 6 });
    expect(diff.validationPassed).toBe(false);
    expect(diff.notes.join(" ")).toMatch(/no universal-parity claim/i);
  });

  it("validationPassed is FALSE when too few fields are comparable", () => {
    const buf = synthCluster(["Doe"], [10, 5, 999]);
    const r = decodeClusterExperimental(buf, ON);
    const diff = compareWithReference(r, [{ label: "A", lfa: 10 }], { minFields: 6 });
    expect(diff.validationPassed).toBe(false);
    expect(diff.notes.join(" ")).toMatch(/comparable/i);
  });

  it("runs on the de-identified fixture without throwing and makes no parity claim", () => {
    const fixture = join(__dirname, "fixtures", "deidentified_waveform.ans");
    if (!existsSync(fixture)) return; // fixture optional in some checkouts
    const buf = readFileSync(fixture);
    const r: ClusterDecodeResult = decodeClusterExperimental(buf, ON);
    expect(r.enabled).toBe(true);
    // No assertion about correctness of recovered values — only that the walk is
    // bounds-safe and self-reports its integrity. Universal parity is NOT claimed.
    expect(typeof r.fullyConsumed).toBe("boolean");
    expect(r.consumedBytes).toBeLessThanOrEqual(r.bufferBytes);
  });
});
