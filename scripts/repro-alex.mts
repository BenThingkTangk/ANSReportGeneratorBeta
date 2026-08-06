/**
 * scripts/repro-alex.mts — local diagnostic harness for the Alex Pare
 * clinical-correctness repair. Prints the safety-critical fields of the
 * generated report for a given .ans file. Read-only; not part of CI.
 *
 *   npx tsx scripts/repro-alex.mts api/_ans/__tests__/fixtures/pare_deid.ans
 */
import { readFileSync } from "node:fs";
import { parseANSFile, generateColomboReport } from "../api/upload.js";
import { parseStudy } from "../api/_ans/parseStudy.js";

const file = process.argv[2] ?? "api/_ans/__tests__/fixtures/pare_deid.ans";
const buf = readFileSync(file);
const study = parseStudy({ buffer: buf, fileName: file });
const data = parseANSFile(buf, file);
const report = generateColomboReport(data);

console.log("== ecg quality ==", JSON.stringify(study.ecg.quality));
console.log("== weight/bmi ==", data.weight, data.bmi);
console.log("== score/tier ==", report.wellnessScore, report.wellnessTier, JSON.stringify((report as any).scorable ?? null));
console.log("== headline ==", report.wellnessBreakdown.headline);
console.log("== patterns ==", JSON.stringify(report.dysfunctionPatterns));
console.log("== respFreq ==", report.respiratoryFrequency);
console.log("== phase HR ==", report.phaseEvents.map((p) => [p.phase, p.meanHR, p.hrvOverallVariabilityMs, p.hrvBeatToBeatMs, p.hrvReliable]));
console.log("== coupling clocks ==", (report.multiParameter?.coupling ?? []).map((c) => [c.startClock, c.endClock]));
console.log("== phaseEvent keys ==", Object.keys(report.phaseEvents[0]));
console.log("== followUp ==", JSON.stringify(report.followUp));
console.log("== breakdown weights ==", JSON.stringify({
  b: report.wellnessBreakdown.baselineAutonomic.weight,
  sb: report.wellnessBreakdown.sympathovagalBalance.weight,
  r: report.wellnessBreakdown.reflexIntegrity.weight,
  o: report.wellnessBreakdown.orthostaticResponse.weight,
  h: report.wellnessBreakdown.hrvReserve.weight,
  rawTotal: report.wellnessBreakdown.rawTotal,
  final: report.wellnessBreakdown.final,
}));
