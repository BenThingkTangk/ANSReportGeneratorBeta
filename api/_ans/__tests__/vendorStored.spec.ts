import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseBinaryHeader,
  readLpString,
} from "../parseBinary.ts";
import { parseStudy } from "../parseStudy.ts";
import {
  parseVendorStoredAnalysis,
  roundHalfEven,
  VENDOR_SUMMARY_SIGNATURE,
} from "../vendorStored.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  path.join(__dirname, "fixtures", name);

function parseStored(name: string) {
  const bytes = readFileSync(fixture(name));
  const binary = parseBinaryHeader(bytes);
  expect(binary.sampling).toBeTruthy();
  return {
    bytes,
    result: parseVendorStoredAnalysis(bytes, binary.sampling!),
  };
}

describe("PhysioPS stored six-phase summary", () => {
  it.each([
    ["jill_deid.ans", 5],
    ["pare_deid.ans", 5],
  ])("decodes %s completely and contiguously", (name, markerCount) => {
    const { result } = parseStored(name);
    expect(result.signature).toBe(VENDOR_SUMMARY_SIGNATURE);
    expect(result.waveletName).toBe("Normalized cmorlet");
    expect(result.markerCount).toBe(markerCount);
    expect(result.phases.map((phase) => phase.code)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
    ]);
    for (let index = 1; index < result.phases.length; index += 1) {
      expect(result.phases[index].startAbs).toBeCloseTo(
        result.phases[index - 1].endAbs,
        5,
      );
    }
  });

  it("matches stable Jill phase metrics and BP marker assignment", () => {
    const { result } = parseStored("jill_deid.ans");
    const [a, b, , d, , f] = result.phases;

    expect(a.durationSec).toBeCloseTo(300.5415315628052, 6);
    expect(a.meanHr).toBeCloseTo(55.518917083740234, 6);
    expect(a.rangeHr).toBeCloseTo(12.73571491241455, 6);
    expect(a.frf).toBeCloseTo(0.14664891362190247, 7);
    expect(a.lfa).toBeCloseTo(0.9085658192634583, 7);
    expect(a.rfa).toBeCloseTo(5.127071380615234, 7);
    expect(a.ratio).toBeCloseTo(0.1772095113992691, 7);
    expect([a.systolic, a.diastolic, a.map, a.pulsePressure]).toEqual([
      92,
      55,
      70,
      37,
    ]);

    expect(b.bpReadingCount).toBe(0);
    expect([b.systolic, b.diastolic, b.map, b.pulsePressure]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect([d.systolic, d.diastolic, d.map, d.pulsePressure]).toEqual([
      95,
      50,
      63,
      45,
    ]);
    expect([f.systolic, f.diastolic, f.map, f.pulsePressure]).toEqual([
      93,
      61,
      71,
      32,
    ]);
  });

  it("matches stable Pare metrics including a phase without BP", () => {
    const { result } = parseStored("pare_deid.ans");
    const [a, b, , d, , f] = result.phases;
    expect([roundHalfEven(a.meanHr), roundHalfEven(a.rangeHr)]).toEqual([62, 15]);
    expect([a.systolic, a.diastolic, a.map, a.pulsePressure]).toEqual([
      117,
      65,
      80,
      52,
    ]);
    expect(b.rfa).toBeCloseTo(27.82298469543457, 6);
    expect(d.ratio).toBeCloseTo(16.177095413208008, 6);
    expect(f.bpReadingCount).toBe(0);
    expect(f.systolic).toBeNull();
  });

  it("implements LabVIEW round-half-to-even", () => {
    expect(roundHalfEven(74.5)).toBe(74);
    expect(roundHalfEven(137.5)).toBe(138);
    expect(roundHalfEven(79.5)).toBe(80);
    expect(roundHalfEven(-2.5)).toBe(-2);
    expect(roundHalfEven(12.49)).toBe(12);
    expect(roundHalfEven(12.51)).toBe(13);
  });

  it("fails closed on a truncated summary and parseStudy falls back safely", () => {
    const { bytes, result } = parseStored("jill_deid.ans");
    const truncated = bytes.subarray(0, bytes.length - 13);
    const binary = parseBinaryHeader(truncated);
    expect(binary.sampling).toBeTruthy();
    expect(() =>
      parseVendorStoredAnalysis(truncated, binary.sampling!),
    ).toThrow();

    const study = parseStudy({
      buffer: truncated,
      fileName: "truncated-complete-file.ans",
    });
    const warningCodes = study.extractionWarnings.map((warning) => warning.code);
    expect(warningCodes).toContain("VENDOR_PHASE_SUMMARY_UNAVAILABLE");
    expect(warningCodes).toContain("PHASES_ECG_DERIVED");
    expect(study.baseline.heartRate.provenance.source).toBe("binary_int16");
    expect(result.summaryOffset).toBeLessThan(bytes.length);
  });

  it("is invariant to filename and patient identity bytes", () => {
    const original = readFileSync(fixture("jill_deid.ans"));
    const mutated = Buffer.from(original);
    const lastName = readLpString(mutated, 0);
    const firstName = readLpString(mutated, lastName.nextOffset);
    mutated.fill("X".charCodeAt(0), lastName.startOffset + 4, lastName.nextOffset);
    mutated.fill("Y".charCodeAt(0), firstName.startOffset + 4, firstName.nextOffset);

    const originalStudy = parseStudy({
      buffer: original,
      fileName: "original-name.ans",
    });
    const mutatedStudy = parseStudy({
      buffer: mutated,
      fileName: "totally-unrelated-person-and-date.ans",
    });

    const clinical = (study: typeof originalStudy) =>
      [study.baseline, study.deepBreathing, study.valsalva, study.standOrTilt].map(
        (phase) => ({
          start: phase.startSec.value,
          end: phase.endSec.value,
          hr: phase.heartRate.value,
          sbp: phase.bp.sbp.value,
          dbp: phase.bp.dbp.value,
          map: phase.bp.map.value,
          lfa: phase.lfa.value,
          rfa: phase.rfa.value,
          ratio: phase.sb.value,
        }),
      );

    expect(clinical(mutatedStudy)).toEqual(clinical(originalStudy));
    expect(mutatedStudy.patient.lastName.value).not.toBe(
      originalStudy.patient.lastName.value,
    );
    expect(mutatedStudy.patient.firstName.value).not.toBe(
      originalStudy.patient.firstName.value,
    );
  });
});
