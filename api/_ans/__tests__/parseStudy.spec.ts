/**
 * Vitest unit tests for the deterministic .ans parser (PR1).
 *
 * Coverage:
 *   - real Pare/Alex + Francey/Shannon binary fixtures
 *   - synthetic happy-path
 *   - missing DOB
 *   - missing physician name
 *   - failed sampling probe (truncated buffer)
 *   - weird ASCII spacing
 *   - missing-vs-normal invariant: null stays null
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseStudy } from "../parseStudy.js";
import { ansStudyToLegacy } from "../legacyAdapter.js";
import { buildSyntheticAns } from "./buildSyntheticAns.js";

const FIXTURE_PARE = path.resolve(
  process.cwd(),
  "fixtures/Pare-Alex-Thu-Jul-11-2024.ans",
);
const FIXTURE_FRANCEY = path.resolve(
  process.cwd(),
  "fixtures/Francey-Shannon-Fri-Oct-24-2025.ans",
);

// The two real-patient binary fixtures live OUTSIDE the repo (.gitignore'd
// for PHI compliance). When the developer has them locally, the suite runs
// the real tests; on CI / clean checkouts the real-binary suites no-op.
const hasPare = existsSync(FIXTURE_PARE);
const hasFrancey = existsSync(FIXTURE_FRANCEY);
const describePare = hasPare ? describe : describe.skip;
const describeFrancey = hasFrancey ? describe : describe.skip;

describePare("parseStudy — real Pare/Alex fixture", () => {
  const buf = readFileSync(FIXTURE_PARE);
  const study = parseStudy({
    buffer: buf,
    fileName: "Pare-Alex-Thu-Jul-11-2024.ans",
  });

  it("extracts the exact patient name from the binary LP-strings", () => {
    expect(study.patient.lastName.value).toBe("Pare");
    expect(study.patient.lastName.provenance.source).toBe("binary_lp_string");
    expect(study.patient.lastName.provenance.confidence).toBe(1);
    expect(study.patient.firstName.value).toBe("Alex");
  });

  it("decodes DOB from the LabVIEW int64 (no inference)", () => {
    expect(study.patient.dob.value).toBe("1975-09-17");
    expect(study.patient.dob.provenance.source).toBe("binary_labview_i64");
    expect(study.patient.dob.provenance.matchedLabel).toBe("labview_int64");
  });

  it("computes age from dob + studyDate (not from a byte-scan)", () => {
    expect(study.patient.ageAtStudy.value).toBe(48);
    expect(study.patient.ageAtStudy.provenance.source).toBe("computed");
  });

  it("picks the study date that matches the filename hint", () => {
    expect(study.fileMetadata.studyDate.value).toBe("2024-07-11");
    expect(study.fileMetadata.studyDate.provenance.matchedLabel).toBe(
      "labview_i64_matched_filename",
    );
  });

  it("locates sampling at 250 Hz and the full 232680 samples", () => {
    expect(study.fileMetadata.samplingRateHz.value).toBe(250);
    expect(study.fileMetadata.dataPointCount.value).toBe(232680);
    expect(study.fileMetadata.ecgTruncated).toBe(false);
  });

  it("extracts the E/I, Valsalva, 30:15 ratios from the ASCII block", () => {
    expect(study.ratios.eiRatio.value).toBeCloseTo(1.22, 2);
    expect(study.ratios.valsalvaRatio.value).toBeCloseTo(1.49, 2);
    expect(study.ratios.thirtyFifteenRatio.value).toBeCloseTo(1.33, 2);
  });

  it("normalizes physician name (strips 'Dr.' prefix)", () => {
    expect(study.patient.physician.value).toBe("Colombo");
  });
});

describeFrancey("parseStudy — real Francey/Shannon fixture", () => {
  const buf = readFileSync(FIXTURE_FRANCEY);
  const study = parseStudy({
    buffer: buf,
    fileName: "Francey-Shannon-Fri-Oct-24-2025.ans",
  });

  it("extracts demographics deterministically (no Jill-Shah branch)", () => {
    expect(study.patient.lastName.value).toBe("Francey");
    expect(study.patient.firstName.value).toBe("Shannon");
    expect(study.patient.dob.value).toBe("1995-05-19");
    expect(study.patient.sex.value).toBe("Female");
    expect(study.patient.physician.value).toBe("Colombo");
  });

  it("computes age 30 at study date 2025-10-24", () => {
    expect(study.patient.ageAtStudy.value).toBe(30);
    expect(study.fileMetadata.studyDate.value).toBe("2025-10-24");
  });

  it("handles the firmware-shifted sampling offset (262 vs 336)", () => {
    expect(study.fileMetadata.samplingRateHz.value).toBe(250);
    expect(study.fileMetadata.dataPointCount.value).toBeGreaterThan(200_000);
  });
});

describe("parseStudy — synthetic happy path", () => {
  it("round-trips a full synthetic study", () => {
    const buf = buildSyntheticAns({
      lastName: "Smith",
      firstName: "John",
      dobIso: "1980-06-15",
      sex: "Male",
      physician: "Dr. Jones",
      studyDateIso: "2024-12-01",
      samplingInterval: 0.004,
      sampleCount: 500,
    });
    const study = parseStudy({ buffer: buf, fileName: "smith-john-2024-12-01.ans" });
    expect(study.patient.lastName.value).toBe("Smith");
    expect(study.patient.firstName.value).toBe("John");
    expect(study.patient.dob.value).toBe("1980-06-15");
    expect(study.patient.sex.value).toBe("Male");
    // physician "Dr." prefix stripped
    expect(study.patient.physician.value).toBe("Jones");
    expect(study.patient.ageAtStudy.value).toBe(44);
    expect(study.fileMetadata.studyDate.value).toBe("2024-12-01");
    expect(study.fileMetadata.samplingRateHz.value).toBe(250);
    expect(study.fileMetadata.dataPointCount.value).toBe(500);
    expect(study.ratios.eiRatio.value).toBeCloseTo(1.45, 2);
    expect(study.anthropometrics.heightInches.value).toBe(5 * 12 + 6); // 5 ft 6 in
  });
});

describe("parseStudy — missing-vs-normal invariants", () => {
  it("returns null DOB (NOT zero or today) when the int64 bytes are zero", () => {
    const buf = buildSyntheticAns({ dobIso: null });
    const study = parseStudy({ buffer: buf, fileName: "missing-dob.ans" });
    expect(study.patient.dob.value).toBeNull();
    expect(study.patient.dob.provenance.source).toBe("missing");
    // Age must also be null when DOB is missing.
    expect(study.patient.ageAtStudy.value).toBeNull();
  });

  it("returns null physician when the LP-string is empty", () => {
    const buf = buildSyntheticAns({ physician: "" });
    const study = parseStudy({ buffer: buf, fileName: "no-physician.ans" });
    expect(study.patient.physician.value).toBeNull();
  });

  it("emits a parser warning when the sampling probe fails", () => {
    // Truncate everything past the physician LP-string and a tiny ASCII tail.
    const buf = buildSyntheticAns({ samplingInterval: 0 });
    const study = parseStudy({ buffer: buf, fileName: "no-sampling.ans" });
    expect(study.fileMetadata.samplingRateHz.value).toBeNull();
    expect(study.fileMetadata.dataPointCount.value).toBeNull();
    const codes = study.extractionWarnings.map((w) => w.code);
    expect(codes).toContain("SAMPLING_PROBE_FAIL");
  });

  it("never substitutes missing fields with zeros or defaults", () => {
    const buf = buildSyntheticAns({ asciiBlock: "" });
    const study = parseStudy({ buffer: buf, fileName: "no-ascii.ans" });
    expect(study.ratios.eiRatio.value).toBeNull();
    expect(study.ratios.valsalvaRatio.value).toBeNull();
    expect(study.ratios.thirtyFifteenRatio.value).toBeNull();
  });
});

describe("parseStudy — odd input handling", () => {
  it("handles weird whitespace in ratio expressions", () => {
    const buf = buildSyntheticAns({
      asciiBlock: "  E/I  Ratio   =    2.10   \r\n  Valsalva   Ratio  =    1.80\r\n",
    });
    const study = parseStudy({ buffer: buf, fileName: "whitespace.ans" });
    expect(study.ratios.eiRatio.value).toBeCloseTo(2.1, 2);
    expect(study.ratios.valsalvaRatio.value).toBeCloseTo(1.8, 2);
  });

  it("parses study date from filename when binary timestamp is absent", () => {
    const buf = buildSyntheticAns({ studyDateIso: null });
    const study = parseStudy({
      buffer: buf,
      fileName: "Doe-Jane-Thu-Jul-11-2024.ans",
    });
    expect(study.fileMetadata.studyDate.value).toBe("2024-07-11");
    expect(study.fileMetadata.studyDate.provenance.source).toBe("filename");
  });

  it("flags out-of-range ages with a RANGE_OUT_OF_BOUNDS warning", () => {
    // Build a study with a DOB in 1850 by writing the int64 directly.
    // Simpler: feed a tiny synthetic ans then override age via the ASCII path.
    const buf = buildSyntheticAns({
      asciiBlock: "Age: 200 yrs\r\n",
      dobIso: null,
    });
    const study = parseStudy({ buffer: buf, fileName: "impossible-age.ans" });
    const codes = study.extractionWarnings.map((w) => w.code);
    expect(codes).toContain("RANGE_OUT_OF_BOUNDS");
  });
});

describe("ansStudyToLegacy adapter", () => {
  it("maps null AnsStudy fields to legacy zero/empty without crashing", () => {
    const buf = buildSyntheticAns({
      dobIso: null,
      physician: "",
      asciiBlock: "",
      samplingInterval: 0,
    });
    const study = parseStudy({ buffer: buf, fileName: "empty.ans" });
    const legacy = ansStudyToLegacy(study, buf);
    expect(legacy.dobString).toBe("");
    expect(legacy.age).toBe(0);
    expect(legacy.physician).toBe("");
    expect(legacy.ecgData).toEqual([]);
    expect(legacy.eiRatio).toBe(0);
  });

  it.skipIf(!hasPare)(
    "materializes the full ECG sample array for the scoring algorithm",
    () => {
      const buf = readFileSync(FIXTURE_PARE);
      const study = parseStudy({
        buffer: buf,
        fileName: "Pare-Alex-Thu-Jul-11-2024.ans",
      });
      const legacy = ansStudyToLegacy(study, buf);
      expect(legacy.ecgData.length).toBe(232680);
      expect(legacy.dobString).toBe("9/17/1975");
      expect(legacy.testDate).toBe("7/11/2024");
      expect(legacy.age).toBe(48);
    },
  );
});

describe("parser confidence", () => {
  it("reports lower overall confidence when many fields are missing", () => {
    const sparse = buildSyntheticAns({
      asciiBlock: "",
      physician: "",
      dobIso: null,
    });
    const sparseStudy = parseStudy({ buffer: sparse, fileName: "sparse.ans" });

    const rich = buildSyntheticAns(); // defaults are well-populated
    const richStudy = parseStudy({ buffer: rich, fileName: "rich.ans" });

    expect(sparseStudy.parserConfidence.overall).toBeLessThan(
      richStudy.parserConfidence.overall,
    );
    expect(sparseStudy.parserConfidence.missingCount).toBeGreaterThan(
      richStudy.parserConfidence.missingCount,
    );
  });
});
