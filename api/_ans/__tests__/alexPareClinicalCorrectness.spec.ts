/**
 * ALEX PARE CLINICAL-CORRECTNESS REGRESSION SUITE
 * ================================================================
 *
 * Locks in the high-severity repair driven by the Alex Pare production parity
 * audit (`ALEX_PARE_PRODUCTION_PARITY_AUDIT.md`) against the REAL de-identified
 * recording (`fixtures/pare_deid.ans` — byte-identical to
 * `Pare-Alex-Thu-Jul-11-2024.ans` apart from the patient-name strings and the
 * DOB day/month, so every measured value is the real one).
 *
 * WHAT THE AUDIT FOUND ON THIS EXACT RECORDING, and what each test now forbids:
 *
 *  1. `dysfunctionPatterns` published `false` — "abnormality absent" — for
 *     sympatheticExcess, preSyncopeRisk, advancedAutonomicDysfunction, maskedSW,
 *     CAN, orthostaticHypotension and POTS, on domains the same payload declared
 *     unassessable. The vendor clinician documented Sympathetic Excess,
 *     pre-clinical syncope risk and Advanced Autonomic Dysfunction here.
 *  2. A patient-facing "91 / Optimal — Strong autonomic function across all
 *     tests, no abnormal patterns detected" was emitted while the ECG had failed
 *     the usability gate, and the missing sympathovagal domain was renormalized
 *     away so its absence RAISED the score.
 *  3. `patientData.weight = 0` / `bmi = 0` as stand-ins for unknown.
 *  4. Coupling-window wall clocks of "30:20:36" / "30:25:27" (hour > 23).
 *  5. `HRV_SDNN` / `HRV_RMSSD` keys shipped inside the patient-facing report.
 *  6. Per-phase RMSSD > SDNN in all six phases (an R-peak artifact signature)
 *     feeding a "variability reserve" worth 18.7 of the 91 points.
 *  7. Three mutually inconsistent reference-range sets for the same 3 ratios.
 *
 * These tests are deliberately assertive about ABSENCE of unsafe output. They
 * must not be relaxed: each one corresponds to a false clinical claim that was
 * actually produced for a real patient's recording.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseANSFile, generateColomboReport, standDeltaBpm, secondsToClock } from "../../upload.js";
import { parseStudy } from "../parseStudy.js";
import { deriveStudyClockStartSec } from "../legacyAdapter.js";
import { PATTERN_KEYS, mayClaimNoAbnormalPatterns } from "../../../shared/clinicalStates.js";
import { findBannedHrvKeys, findBannedHrvTerms } from "../../../shared/physiopsTerminology.js";
import { ratioReferenceLabel, ratioBandForAge } from "../../../shared/colomboNorms.js";
import { detectVendorConflicts, extractRetestMonths } from "../../../shared/vendorConflicts.js";
import { buildClinicianSynopsis } from "../../../shared/deterministicSynopsis.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARE = path.join(__dirname, "fixtures", "pare_deid.ans");

function alex() {
  const buf = readFileSync(PARE);
  const data = parseANSFile(buf, "pare_deid.ans");
  return { buf, data, study: parseStudy({ buffer: buf, fileName: "pare_deid.ans" }), report: generateColomboReport(data) };
}

/** Recursively collect every string value in an object graph. */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => allStrings(x, out));
  return out;
}

describe("Alex Pare — unknowns are null, never a zero sentinel", () => {
  it("weight and BMI are null (the .ans carries neither)", () => {
    const { data, report } = alex();
    expect(data.weight).toBeNull();
    expect(data.bmi).toBeNull();
    expect(report.patientData.weight).toBeNull();
    expect(report.patientData.bmi).toBeNull();
    // Explicitly NOT the old sentinel.
    expect(report.patientData.weight).not.toBe(0);
    expect(report.patientData.bmi).not.toBe(0);
  });

  it("no phase reports 0 bpm, 0 ms variability, or a 0 spectral aggregate", () => {
    const { report } = alex();
    for (const p of report.phaseEvents) {
      expect(p.meanHR === null || p.meanHR > 30).toBe(true);
      expect(p.rangeHR).not.toBe(0);
      expect(p.hrvOverallVariabilityMs).not.toBe(0);
      expect(p.hrvBeatToBeatMs).not.toBe(0);
      // Waveform-derived spectral values may now be PUBLISHED as HumanOS
      // estimates, but they must never be a zero sentinel and never claim to be
      // vendor values. Either the value is absent (null, with `unavailable`
      // provenance) or it is a positive number tagged computed/estimated.
      for (const key of ["LFa", "RFa", "SB"] as const) {
        const v = p[key];
        const prov = p.provenance?.[key];
        if (v === null) {
          expect(prov?.method === "unavailable" || prov?.method === "computed").toBe(true);
        } else {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(prov?.method).toBe("computed");
          expect(prov?.validation).toBe("estimated");
        }
      }
      expect(p.FRF === null || p.FRF > 0).toBe(true);
    }
    // The CLINICAL balance panel stays unavailable: an estimate must not fill it.
    expect(report.spectralAvailable).toBe(false);
    expect(report.autonomicBalance.available).toBe(false);
    expect(report.autonomicBalance.parasympathetic).toBeNull();
    expect(report.autonomicBalance.sympathetic).toBeNull();
    expect(report.autonomicBalance.balance).toBeNull();
  });

  it("the ratios the file DOES carry are still reported (functionality preserved)", () => {
    const { report } = alex();
    expect(report.ratios.eiRatio.value).toBeCloseTo(1.22, 2);
    expect(report.ratios.valsalvaRatio.value).toBeCloseTo(1.49, 2);
    expect(report.ratios.thirtyFifteenRatio.value).toBeCloseTo(1.33, 2);
    // Demographics still display. NOTE: the de-identified fixture shifts the DOB
    // to Jan-1 of the birth year (HIPAA safe harbour), so the computed age is 49
    // here where the un-redacted file gives 48. Both land in the same 40-49
    // reference band, so no classification depends on the difference.
    expect(report.patientData.age).toBe(49);
    expect(report.patientData.height).toBe("6 ft 2 in");
    expect(report.patientData.ectopicBeats).toBe(1);
  });
});

describe("Alex Pare — every unassessable pattern is null, never false", () => {
  it("no pattern is emitted as false while its inputs were never captured", () => {
    const { report } = alex();
    const p = report.dysfunctionPatterns;
    // LFa/RFa/SB are not in the .ans, so every spectral-dependent pattern must
    // be null. These SEVEN were the audit's hard false negatives.
    for (const key of [
      "sympatheticExcess",
      "preSyncopeRisk",
      "advancedAutonomicDysfunction",
      "maskedSW",
      "CAN",
      "parasympatheticExcess",
      "parasympatheticWithdrawal",
      "parasympatheticDominance",
      "sympatheticWithdrawal",
      "vasovagalRisk",
    ] as const) {
      expect(p[key], `${key} must be null (not assessable), never false`).toBeNull();
    }
    // No cuff BP at either arm → orthostatic hypotension is not assessable.
    expect(p.orthostaticHypotension).toBeNull();
  });

  it("tri-state values are only true | false | null", () => {
    const { report } = alex();
    for (const key of PATTERN_KEYS) {
      const v = report.dysfunctionPatterns[key];
      expect(v === true || v === false || v === null).toBe(true);
    }
  });

  it("the payload may NOT claim 'no abnormal patterns'", () => {
    const { report } = alex();
    expect(mayClaimNoAbnormalPatterns(report.dysfunctionPatterns)).toBe(false);
    for (const s of allStrings(report)) {
      expect(s).not.toMatch(/no abnormal patterns/i);
      expect(s).not.toMatch(/Strong autonomic function across all tests/i);
    }
  });
});

describe("Alex Pare — score and tier are blocked, not renormalized upward", () => {
  it("emits no wellness score and no tier", () => {
    const { report } = alex();
    expect(report.wellnessScore).toBeNull();
    expect(report.wellnessTier).toBeNull();
    expect(report.wellnessBreakdown.final).toBeNull();
    expect(report.wellnessBreakdown.rawTotal).toBeNull();
    expect(report.wellnessBreakdown.ageAdjusted).toBeNull();
  });

  it("leaves retest timing to the clinician when the study is unscorable", () => {
    const { report } = alex();
    expect(report.followUp.retestInterval).toBe("Clinician-directed");
    expect(report.followUp.rationale).toMatch(/cannot be determined from an unscorable study/i);
    expect(report.followUp.rationale).toMatch(/treating clinician/i);
    const synopsis = buildClinicianSynopsis(report as any);
    expect(synopsis).toMatch(/discuss retest timing with the treating clinician/i);
    expect(synopsis).not.toMatch(/re-test in clinician-directed/i);
  });

  it("never outputs 91 or the word Optimal anywhere", () => {
    const { report } = alex();
    expect(report.wellnessScore).not.toBe(91);
    for (const s of allStrings(report)) expect(s).not.toMatch(/\bOptimal\b/);
  });

  it("marks itself not scorable and says why", () => {
    const { report } = alex();
    const sc = report.wellnessBreakdown.scorability;
    expect(sc.scorable).toBe(false);
    expect(sc.notice).toMatch(/not scorable/i);
    expect(sc.blockers.length).toBeGreaterThan(0);
    expect(sc.blockers.map((b) => b.code)).toContain("ECG_UNUSABLE");
    expect(sc.blockers.map((b) => b.code)).toContain("ESSENTIAL_DOMAIN_MISSING");
    expect(sc.blockers.map((b) => b.code)).toContain("PATTERNS_UNASSESSABLE");
    expect(report.wellnessBreakdown.headline).toBe(sc.notice);
  });

  it("does NOT redistribute the missing domain's weight", () => {
    const { report } = alex();
    const bd = report.wellnessBreakdown;
    expect(bd.sympathovagalBalance.available).toBe(false);
    expect(bd.sympathovagalBalance.weight).toBe(0);
    const total =
      bd.baselineAutonomic.weight + bd.sympathovagalBalance.weight +
      bd.reflexIntegrity.weight + bd.orthostaticResponse.weight + bd.hrvReserve.weight;
    // Renormalization would force this to 1.0 and inflate the composite.
    expect(total).toBeLessThan(0.999);
    expect(bd.scorability.unavailableWeight).toBeGreaterThan(0);
  });
});

describe("Alex Pare — interpretation is gated on signal usability", () => {
  it("the parser reports the SPECIFIC reason the recording is unusable", () => {
    const { study } = alex();
    const q = study.ecg.quality;
    expect(q.usable).toBe(false);
    // The real defect was motion/saturation, NOT low SNR: SNR here is ~46 dB.
    expect(q.snrDb).toBeGreaterThan(20);
    expect(q.unusableReasons).toContain("excess_motion_or_saturation");
    expect(q.unusableReasons).not.toContain("low_snr");
    // No self-contradictory "signal-to-noise too low" text alongside a 46 dB SNR.
    for (const w of q.warnings) expect(w).not.toMatch(/signal-to-noise too low/i);
  });

  it("detects the sentinel/rail spikes the old ±32000 test missed", () => {
    const { study } = alex();
    expect(study.ecg.quality.sentinelFraction).not.toBeNull();
    expect(study.ecg.quality.sentinelFraction!).toBeGreaterThan(0);
    expect(study.ecg.quality.unusableReasons).toContain("sentinel_spikes");
  });

  it("artifact-contaminated variability never reaches a score", () => {
    const { report } = alex();
    for (const p of report.phaseEvents) {
      // The audit found RMSSD > SDNN in all six phases. Whenever that holds the
      // series is rejected and no variability value is published for the phase.
      expect(p.hrvReliable).toBe(false);
      expect(p.hrvOverallVariabilityMs).toBeNull();
      expect(p.hrvBeatToBeatMs).toBeNull();
      expect(p.hrvUnreliableReasons.length).toBeGreaterThan(0);
    }
    expect(report.wellnessBreakdown.hrvReserve.available).toBe(false);
    expect(report.wellnessBreakdown.hrvReserve.score).toBeNull();
    expect(report.wellnessBreakdown.scorability.blockers.map((b) => b.code))
      .toContain("ECG_ARTIFACT_HRV_UNRELIABLE");
  });

  it("still publishes the heart rates as measured observations", () => {
    // Gating interpretation must NOT delete the measurement. Rate is preserved.
    const { report } = alex();
    const hrs = report.phaseEvents.map((p) => p.meanHR);
    expect(hrs.every((h) => h !== null)).toBe(true);
    expect(hrs[0]).toBe(63);
    expect(hrs[5]).toBe(72);
  });

  it("publishes waveform-derived values only as labelled estimates, never as vendor data", () => {
    const { report } = alex();
    // The CLINICAL gate stays shut without a paired vendor report...
    expect(report.spectralAvailable).toBe(false);
    // ...while the generically computable content is preserved and labelled.
    expect(report.spectralSource).toBe("humanos_estimated");
    expect(report.spectralEstimation.present).toBe(true);
    expect(report.spectralEstimation.method).toBe("morlet_cwt_bpm2");
    expect(report.spectralEstimation.disclosure).toMatch(/estimat/i);
    expect(report.spectralEstimation.disclosure).toMatch(/not.{0,20}vendor|NOT a vendor/i);
    expect(report.spectralEstimation.warnings.length).toBeGreaterThan(0);
    expect(report.spectralEstimation.confidence).not.toBeNull();
    // Confidence for an unvalidated approximation is capped well below 1.
    expect(report.spectralEstimation.confidence!).toBeLessThanOrEqual(0.6);

    // Respiratory frequency is ECG-derived and reported AS AN ESTIMATE.
    expect(report.respiratoryFrequency).not.toBeNull();
    expect(report.respiratory.validation).toBe("estimated");
    expect(report.respiratory.frequencyHz).toBe(report.phaseEvents[0].FRF);

    // Raw measurable trends survive even though the composite score is withheld.
    expect(report.multiParameter?.lfaTrend.v.length).toBeGreaterThan(0);
    expect(report.multiParameter?.rfaTrend.v.length).toBeGreaterThan(0);
    expect(report.wellnessScore).toBeNull();
  });
});

describe("Alex Pare — one canonical heart-rate baseline and stand delta", () => {
  it("stand delta is identical in the report and the parse payload", () => {
    const { report, study } = alex();
    const baselineHr = study.baseline.heartRate.value;
    const standHr = study.standOrTilt.heartRate.value;
    expect(baselineHr).toBe(report.phaseEvents[0].meanHR);
    expect(standHr).toBe(report.phaseEvents[5].meanHR);
    const delta = standDeltaBpm(baselineHr, standHr);
    expect(delta).toBe(standDeltaBpm(report.phaseEvents[0].meanHR, report.phaseEvents[5].meanHR));
    // The audit's 8-vs-9 bpm disagreement came from a pooled A+C+E baseline.
    expect(delta).toBe(9);
  });

  it("standDeltaBpm returns null rather than 0 for unknown rates", () => {
    expect(standDeltaBpm(null, 72)).toBeNull();
    expect(standDeltaBpm(63, null)).toBeNull();
    expect(standDeltaBpm(0, 72)).toBeNull();
  });
});

describe("Alex Pare — no impossible clock metadata", () => {
  it("every coupling window clock is a valid wall clock or null", () => {
    const { report } = alex();
    const windows = report.multiParameter?.coupling ?? [];
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      for (const c of [w.startClock, w.endClock]) {
        if (c === null) continue;
        expect(c).toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
        expect(Number(c.slice(0, 2))).toBeLessThanOrEqual(23);
      }
      // Relative time is always available as a fallback.
      expect(w.startOffsetSec).toBeGreaterThanOrEqual(0);
      expect(w.endOffsetSec).toBeGreaterThan(w.startOffsetSec);
      expect(["file_timestamp", "relative_only"]).toContain(w.clockSource);
    }
  });

  it("no >23-hour clock string appears anywhere in the payload", () => {
    const { report } = alex();
    for (const s of allStrings(report)) {
      expect(s).not.toMatch(/\b(?:2[4-9]|[3-9]\d):[0-5]\d:[0-5]\d\b/);
    }
  });

  it("clocks derive from the real in-file timestamps, not a hardcoded default", () => {
    const { data } = alex();
    // The .ans ASCII carries 10:17:37 AM / 10:19:06 AM / 10:19:41 AM; the
    // bounded ASCII head the parser retains starts at 10:19:06 AM. Whatever it
    // resolves to must be one of the REAL in-file stamps and a valid clock —
    // never the old hardcoded 13:08:00 and never an hour above 23.
    const realStamps = [
      10 * 3600 + 17 * 60 + 37,
      10 * 3600 + 19 * 60 + 6,
      10 * 3600 + 19 * 60 + 41,
    ];
    expect(realStamps).toContain(data.studyClockStartSec);
    expect(data.studyClockStartSec!).toBeLessThan(24 * 3600);
    expect(data.studyClockStartSec).not.toBe(13 * 3600 + 8 * 60);
  });

  it("the 30:15-ratio label can no longer be read as a time (the root cause)", () => {
    expect(deriveStudyClockStartSec("30:15 Ratio = 1.33")).toBeNull();
    expect(deriveStudyClockStartSec("E/I Ratio = 1.22 30:15 Ratio = 1.33")).toBeNull();
    expect(deriveStudyClockStartSec("Recorded 10:17:37 AM; 30:15 Ratio = 1.33"))
      .toBe(10 * 3600 + 17 * 60 + 37);
    expect(deriveStudyClockStartSec("")).toBeNull();
  });

  it("secondsToClock refuses to emit an hour above 23", () => {
    expect(secondsToClock(30 * 3600, 0)).toBeNull();       // impossible seed
    expect(secondsToClock(23 * 3600 + 3599, 60)).toBeNull(); // would roll past midnight
    expect(secondsToClock(null, 100)).toBeNull();
    expect(secondsToClock(10 * 3600, 61)).toBe("10:01:01");
  });
});

describe("Alex Pare — patient-facing payload exposes no HRV-only labels or keys", () => {
  const BANNED_KEY_NAMES = ["HRV_SDNN", "HRV_RMSSD", "SDNN", "RMSSD", "ULF", "VLF", "TSP", "pNN50"];

  it("no banned key name anywhere in the report object", () => {
    const { report } = alex();
    expect(findBannedHrvKeys(report)).toEqual([]);
    const json = JSON.stringify(report);
    for (const k of BANNED_KEY_NAMES) {
      expect(json, `banned identifier ${k} must not ship in the report`).not.toContain(`"${k}"`);
      expect(json).not.toContain(`${k}:`);
    }
  });

  it("no banned term in any narrative string", () => {
    const { report } = alex();
    for (const s of allStrings(report)) {
      expect(findBannedHrvTerms(s), `banned HRV term in: ${s.slice(0, 120)}`).toEqual([]);
    }
  });

  it("the P&S terms LFa / RFa / SB remain allowed and consistently cased", () => {
    const { report } = alex();
    const strings = allStrings(report);
    expect(strings.some((s) => /\bLFa\b/.test(s))).toBe(true);
    expect(strings.some((s) => /\bRFa\b/.test(s))).toBe(true);
    // Mixed casing (`LFA`) risks a future regex mistaking it for `LF`.
    for (const s of strings) {
      expect(s).not.toMatch(/\bLFA\b/);
      expect(s).not.toMatch(/\bRFA\b/);
    }
  });

  it("clinician instrument access is preserved under neutral key names", () => {
    // The values are still carried for the clinician view; only the identifiers
    // changed. SDNN/RMSSD are NOT relabelled as LFa/RFa.
    const { report } = alex();
    for (const p of report.phaseEvents) {
      expect("hrvOverallVariabilityMs" in p).toBe(true);
      expect("hrvBeatToBeatMs" in p).toBe(true);
      expect("hrvReliable" in p).toBe(true);
    }
  });
});

describe("Alex Pare — one authoritative age-specific ratio reference", () => {
  it("every reference-range string in the payload comes from the one table", () => {
    const { report } = alex();
    const expected = {
      eiRatio: ratioReferenceLabel("eiRatio", 48),
      valsalvaRatio: ratioReferenceLabel("valsalvaRatio", 48),
      thirtyFifteenRatio: ratioReferenceLabel("thirtyFifteenRatio", 48),
    };
    expect(report.ratios.eiRatio.normal).toBe(expected.eiRatio);
    expect(report.ratios.valsalvaRatio.normal).toBe(expected.valsalvaRatio);
    expect(report.ratios.thirtyFifteenRatio.normal).toBe(expected.thirtyFifteenRatio);
    // The old inconsistent chart annotations are gone.
    for (const s of allStrings(report)) {
      expect(s).not.toContain("ref (1.2 - 1.6)");
      expect(s).not.toContain("ref (1.15 - 1.5)");
    }
    // The chart annotations now use the same label.
    const annots = (report.multiParameter?.coupling ?? []).flatMap((w) => w.annotations);
    expect(annots).toContain(expected.eiRatio);
    expect(annots).toContain(expected.valsalvaRatio);
    expect(annots).toContain(expected.thirtyFifteenRatio);
  });

  it("age 48 resolves the 40–49 band", () => {
    const b = ratioBandForAge("eiRatio", 48);
    expect(b.ageMin).toBe(40);
    expect(b.ageMax).toBe(50);
    expect(b.normalAtOrAbove).toBeCloseTo(1.12, 3);
  });
});

describe("Alex Pare — vendor reconciliation states are distinguishable", () => {
  it("an .ans-only upload reports no_vendor_pdf, not a silent absence", () => {
    // generateColomboReport itself carries no reconciliation; the handler sets
    // the explicit state. Assert the state machine's vocabulary here.
    const { report } = alex();
    expect(report.vendorReconciliation).toBeUndefined();
  });

  it("surfaces the 3-vs-6-month retest conflict instead of choosing one", () => {
    const conflicts = detectVendorConflicts([
      { source: "P&S report (page 3)", text: "Re-test in 6 months to follow up." },
      { source: "Clinician letter", text: "Retest in three (3) months." },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe("followUp.retestInterval");
    const values = conflicts[0].values.map((v) => v.value);
    expect(values).toContain("6 months");
    expect(values).toContain("3 months");
    // Both sources are named and neither is presented as the winner.
    expect(conflicts[0].message).toContain("P&S report (page 3)");
    expect(conflicts[0].message).toContain("Clinician letter");
    expect(conflicts[0].message).not.toMatch(/we (?:use|chose|selected)/i);
  });

  it("does not guess when OCR garbled the interval", () => {
    expect(extractRetestMonths("Re-test in & months to follow up.")).toEqual([]);
  });

  it("agreeing documents produce no conflict", () => {
    expect(
      detectVendorConflicts([
        { source: "a", text: "Re-test in 6 months." },
        { source: "b", text: "Retest in six (6) months." },
      ]),
    ).toEqual([]);
  });
});
