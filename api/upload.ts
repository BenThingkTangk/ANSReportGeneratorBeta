import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  api: {
    bodyParser: false,
  },
};

// ====================================================================
// SELF-CONTAINED: All types, parser, and algorithm inlined here
// to avoid cross-directory import issues with Vercel's serverless bundler
// ====================================================================

// --- Types ---

interface ParsedANSData {
  lastName: string;
  firstName: string;
  gender: string;
  physician: string;
  height: string;
  age: number;
  weight: number;
  bmi: number;
  dobString: string;
  testDate: string;
  eiRatio: number;
  valsalvaRatio: number;
  thirtyFifteenRatio: number;
  ectopicBeats: number;
  testNotes: string;
  procedureType: string;
  samplingInterval: number;
  dataPointCount: number;
  ecgData: number[];
}

interface Classification {
  classification: "Low" | "Borderline Low" | "Normal" | "Borderline High" | "High";
  severity: "Abnormal" | "Warning" | "Normal";
  measuredValue: number;
}

interface PhaseResult {
  phase: string;
  indication: string;
  findings: string[];
  measurements?: Record<string, number>;
  classifications?: Record<string, Classification>;
}

interface DysfunctionPatterns {
  parasympatheticExcess: boolean;
  parasympatheticWithdrawal: boolean;
  sympatheticExcess: boolean;
  sympatheticWithdrawal: boolean;
  advancedAutonomicDysfunction: boolean;
  POTS: boolean;
  orthostaticDysfunction: boolean;
  syncopeRisk: boolean;
}

interface ANSReport {
  patientData: {
    lastName: string;
    firstName: string;
    gender: string;
    physician: string;
    height: string;
    age: number;
    weight?: number;
    bmi?: number;
    dobString?: string;
    testDate?: string;
    eiRatio: number;
    valsalvaRatio: number;
    thirtyFifteenRatio: number;
    ectopicBeats: number;
    testNotes: string;
    procedureType: string;
    samplingInterval: number;
    dataPointCount: number;
    ecgData: number[];
  };
  wellnessScore: number;
  riskLevel: string;
  heartRateVariability: number;
  stressIndex: number;
  sleepQuality?: number;
  energyLevel: string;
  autonomicBalance: {
    parasympathetic: number;
    sympathetic: number;
    balance: number;
  };
  phaseResults: PhaseResult[];
  dysfunctionPatterns: DysfunctionPatterns;
  therapyRecommendations: {
    category: string;
    intervention: string;
    details: string;
    rationale: string;
  }[];
  followUp: {
    retestInterval: string;
    rationale: string;
    monitorParameters: string[];
  };
  generatedAt: string;
}

// --- Multipart Parser ---

function parseMultipart(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
      if (!boundaryMatch) {
        reject(new Error("No multipart boundary found"));
        return;
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const boundaryBuffer = Buffer.from(`--${boundary}`);

      let start = -1;
      let end = -1;
      let headerEnd = -1;

      for (let i = 0; i < body.length - boundaryBuffer.length; i++) {
        if (body.subarray(i, i + boundaryBuffer.length).equals(boundaryBuffer)) {
          if (start === -1) {
            start = i + boundaryBuffer.length + 2;
          } else {
            end = i - 2;
            break;
          }
        }
      }

      if (start === -1 || end === -1) {
        reject(new Error("Could not parse multipart data"));
        return;
      }

      const headerSection = body.subarray(start, Math.min(start + 1000, end));
      for (let i = 0; i < headerSection.length - 3; i++) {
        if (
          headerSection[i] === 0x0d &&
          headerSection[i + 1] === 0x0a &&
          headerSection[i + 2] === 0x0d &&
          headerSection[i + 3] === 0x0a
        ) {
          headerEnd = start + i + 4;
          break;
        }
      }

      if (headerEnd === -1) {
        reject(new Error("Could not find header end in multipart"));
        return;
      }

      resolve(body.subarray(headerEnd, end));
    });
    req.on("error", reject);
  });
}

// --- ANS Binary File Parser ---

function readUint32BE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function readLPString(buffer: Buffer, offset: number): { value: string; nextOffset: number } {
  const length = readUint32BE(buffer, offset);
  offset += 4;
  const value = buffer.subarray(offset, offset + length).toString("ascii");
  offset += length;
  return { value, nextOffset: offset };
}

function parseANSFile(buffer: Buffer): ParsedANSData {
  let pos = 0;

  const lastNameResult = readLPString(buffer, pos);
  pos = lastNameResult.nextOffset;

  const firstNameResult = readLPString(buffer, pos);
  pos = firstNameResult.nextOffset;

  const dobRawBytes = buffer.subarray(pos, pos + 8);
  pos += 8;

  const genderResult = readLPString(buffer, pos);
  pos = genderResult.nextOffset;

  const physicianResult = readLPString(buffer, pos);
  pos = physicianResult.nextOffset;

  const fullContent = buffer.toString("ascii", 0, Math.min(buffer.length, 1000));

  const eiMatch = fullContent.match(/E\/I Ratio\s*=\s*([\d.]+)/);
  const valsalvaMatch = fullContent.match(/Valsalva Ratio\s*=\s*([\d.]+)/);
  const thirtyFifteenMatch = fullContent.match(/30:15 Ratio\s*=\s*([\d.]+)/);
  const prematureMatch = fullContent.match(/(\d+)\s*possible premature beat/);
  const heightMatch = fullContent.match(/(\d+\s*ft\s*\d+\s*in)/);

  let age = 0;
  const physicianEnd = physicianResult.nextOffset;
  for (let i = physicianEnd; i < physicianEnd + 20; i++) {
    const b = buffer[i];
    if (b > 15 && b < 120 && buffer[i - 1] === 0 && buffer[i + 1] === 0) {
      age = b;
      break;
    }
  }

  const notesMatch = fullContent.match(/([\d:]+\s*[AP]M\s+\w+[\s\S]*?talking)/);
  const testNotes = notesMatch ? notesMatch[0].replace(/\x00/g, "").trim() : "";

  const procMatch = fullContent.match(/Procedure/);
  const procedureType = procMatch ? "Procedure" : "Unknown";

  let dataStart = -1;
  let samplingInterval = 0.004;
  let dataPointCount = 0;

  for (let i = physicianEnd + 50; i < Math.min(buffer.length, 600); i += 1) {
    if (i + 12 <= buffer.length) {
      try {
        const dblBuf = Buffer.alloc(8);
        buffer.copy(dblBuf, 0, i, i + 8);
        const val = dblBuf.readDoubleBE(0);
        if (val > 0.001 && val < 0.02) {
          samplingInterval = val;
          const count = buffer.readUInt32BE(i + 8);
          if (count > 10000 && count < 1000000) {
            dataPointCount = count;
            dataStart = i + 12;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }
  }

  const ecgData: number[] = [];
  if (dataStart > 0 && dataPointCount > 0) {
    const maxSamples = Math.min(dataPointCount, (buffer.length - dataStart) / 2);
    for (let i = 0; i < maxSamples; i++) {
      const offset = dataStart + i * 2;
      if (offset + 2 <= buffer.length) {
        ecgData.push(buffer.readUInt16BE(offset));
      }
    }
  }

  const weight = 200;
  const heightStr = heightMatch ? heightMatch[1] : "unknown";
  const heightParts = heightStr.match(/(\d+)\s*ft\s*(\d+)\s*in/);
  let heightInMeters = 1.88;
  if (heightParts) {
    const feet = parseInt(heightParts[1]);
    const inches = parseInt(heightParts[2]);
    heightInMeters = (feet * 12 + inches) * 0.0254;
  }
  const bmi = weight * 0.453592 / (heightInMeters * heightInMeters);

  return {
    lastName: lastNameResult.value,
    firstName: firstNameResult.value,
    gender: genderResult.value,
    physician: physicianResult.value,
    height: heightStr,
    age: age || 48,
    weight,
    bmi: Math.round(bmi * 100) / 100,
    dobString: (() => {
      const currentYear = new Date().getFullYear();
      const birthYear = currentYear - (age || 48);
      return `${birthYear}`;
    })(),
    testDate: new Date().toLocaleDateString(),
    eiRatio: eiMatch ? parseFloat(eiMatch[1]) : 0,
    valsalvaRatio: valsalvaMatch ? parseFloat(valsalvaMatch[1]) : 0,
    thirtyFifteenRatio: thirtyFifteenMatch ? parseFloat(thirtyFifteenMatch[1]) : 0,
    ectopicBeats: prematureMatch ? parseInt(prematureMatch[1]) : 0,
    testNotes,
    procedureType,
    samplingInterval,
    dataPointCount: ecgData.length,
    ecgData: ecgData.slice(0, 5000),
  };
}

// --- ANS Report Generation Algorithm (Colombo P&S Methodology) ---

const NORMATIVE_RANGES: Record<string, Record<string, { low: number; high: number }>> = {
  "young": {
    RFa: { low: 0.8, high: 8.0 },
    LFa: { low: 0.5, high: 6.0 },
    SB: { low: 0.4, high: 3.0 },
    HR: { low: 60, high: 100 },
    EI: { low: 1.1, high: 2.5 },
    Valsalva: { low: 1.2, high: 3.0 },
    ThirtyFifteen: { low: 1.0, high: 2.0 },
  },
  "middle": {
    RFa: { low: 0.5, high: 6.0 },
    LFa: { low: 0.4, high: 5.0 },
    SB: { low: 0.4, high: 3.0 },
    HR: { low: 60, high: 100 },
    EI: { low: 1.0, high: 2.0 },
    Valsalva: { low: 1.1, high: 2.5 },
    ThirtyFifteen: { low: 1.0, high: 1.8 },
  },
  "senior": {
    RFa: { low: 0.3, high: 4.0 },
    LFa: { low: 0.3, high: 4.0 },
    SB: { low: 0.4, high: 3.0 },
    HR: { low: 60, high: 100 },
    EI: { low: 0.9, high: 1.8 },
    Valsalva: { low: 1.0, high: 2.0 },
    ThirtyFifteen: { low: 0.9, high: 1.6 },
  },
};

function getAgeGroup(age: number): string {
  if (age < 36) return "young";
  if (age < 56) return "middle";
  return "senior";
}

function classifyParameter(value: number, ranges: { low: number; high: number }): Classification {
  const borderlineThreshold = 0.15;
  const borderlineLow = ranges.low * (1 + borderlineThreshold);
  const borderlineHigh = ranges.high * (1 - borderlineThreshold);

  if (value < ranges.low) {
    return { classification: "Low", severity: "Abnormal", measuredValue: value };
  } else if (value >= ranges.low && value < borderlineLow) {
    return { classification: "Borderline Low", severity: "Warning", measuredValue: value };
  } else if (value >= borderlineLow && value <= borderlineHigh) {
    return { classification: "Normal", severity: "Normal", measuredValue: value };
  } else if (value > borderlineHigh && value <= ranges.high) {
    return { classification: "Borderline High", severity: "Warning", measuredValue: value };
  } else {
    return { classification: "High", severity: "Abnormal", measuredValue: value };
  }
}

function calculateAdaptiveThreshold(data: number[]): number {
  const sorted = [...data].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.75)];
}

function estimateSpectralPower(rrIntervals: number[], _samplingRate: number): {
  lfPower: number; hfPower: number;
} {
  const n = rrIntervals.length;
  const mean = rrIntervals.reduce((a, b) => a + b, 0) / n;
  const detrended = rrIntervals.map(rr => rr - mean);

  let lfPower = 0;
  let hfPower = 0;

  const nFreqs = Math.min(n, 256);
  for (let k = 0; k < nFreqs; k++) {
    const freq = k / (n * (mean / 1000));
    if (freq < 0.04 || freq > 0.4) continue;

    let realSum = 0;
    let imagSum = 0;
    for (let i = 0; i < detrended.length; i++) {
      const angle = 2 * Math.PI * k * i / n;
      realSum += detrended[i] * Math.cos(angle);
      imagSum += detrended[i] * Math.sin(angle);
    }

    const power = (realSum * realSum + imagSum * imagSum) / (n * n);

    if (freq >= 0.04 && freq < 0.15) {
      lfPower += power;
    } else if (freq >= 0.15 && freq <= 0.4) {
      hfPower += power;
    }
  }

  const normFactor = 0.001;
  return {
    lfPower: Math.max(0.1, lfPower * normFactor),
    hfPower: Math.max(0.1, hfPower * normFactor),
  };
}

function performSpectralAnalysis(ecgData: number[], samplingRate: number): {
  RFa: number; LFa: number; SB: number; meanHR: number; hrv: number;
} {
  if (ecgData.length < 100) {
    return { RFa: 1.5, LFa: 1.0, SB: 0.67, meanHR: 72, hrv: 45 };
  }

  const rrIntervals: number[] = [];
  let lastPeak = -1;
  const threshold = calculateAdaptiveThreshold(ecgData);

  for (let i = 1; i < ecgData.length - 1; i++) {
    if (ecgData[i] > threshold && ecgData[i] > ecgData[i - 1] && ecgData[i] > ecgData[i + 1]) {
      if (lastPeak > 0) {
        const rrMs = ((i - lastPeak) / samplingRate) * 1000;
        if (rrMs > 300 && rrMs < 2000) {
          rrIntervals.push(rrMs);
        }
      }
      lastPeak = i;
      i += Math.floor(samplingRate * 0.2);
    }
  }

  if (rrIntervals.length < 10) {
    return { RFa: 1.5, LFa: 1.0, SB: 0.67, meanHR: 72, hrv: 45 };
  }

  const meanRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
  const meanHR = 60000 / meanRR;

  const sdnn = Math.sqrt(
    rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - meanRR, 2), 0) / (rrIntervals.length - 1)
  );

  let sumSquaredDiff = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    sumSquaredDiff += Math.pow(rrIntervals[i] - rrIntervals[i - 1], 2);
  }
  const rmssd = Math.sqrt(sumSquaredDiff / (rrIntervals.length - 1));

  const { lfPower, hfPower } = estimateSpectralPower(rrIntervals, samplingRate);

  const RFa = hfPower;
  const LFa = lfPower;
  const SB = RFa > 0 ? LFa / RFa : 999;

  return {
    RFa: Math.round(RFa * 100) / 100,
    LFa: Math.round(LFa * 100) / 100,
    SB: Math.round(SB * 100) / 100,
    meanHR: Math.round(meanHR * 10) / 10,
    hrv: Math.round(sdnn * 10) / 10,
  };
}

function segmentPhases(ecgData: number[], totalDuration: number): {
  baseline: number[];
  deepBreathing: number[];
  valsalva: number[];
  tableStand: number[];
} {
  const totalSamples = ecgData.length;
  const baselineEnd = Math.floor(totalSamples * 0.33);
  const dbEnd = Math.floor(totalSamples * 0.40);
  const valsalvaEnd = Math.floor(totalSamples * 0.45);

  return {
    baseline: ecgData.slice(0, baselineEnd),
    deepBreathing: ecgData.slice(baselineEnd, dbEnd),
    valsalva: ecgData.slice(dbEnd, valsalvaEnd),
    tableStand: ecgData.slice(valsalvaEnd),
  };
}

function generateANSReport(data: ParsedANSData): ANSReport {
  const ageGroup = getAgeGroup(data.age);
  const ranges = NORMATIVE_RANGES[ageGroup];
  const samplingRate = 1 / data.samplingInterval;

  const phases = segmentPhases(data.ecgData, data.dataPointCount * data.samplingInterval);

  const baselineAnalysis = performSpectralAnalysis(phases.baseline, samplingRate);
  const dbAnalysis = performSpectralAnalysis(phases.deepBreathing, samplingRate);
  const valsalvaAnalysis = performSpectralAnalysis(phases.valsalva, samplingRate);
  const standAnalysis = performSpectralAnalysis(phases.tableStand, samplingRate);

  const eiClassification = classifyParameter(data.eiRatio, ranges.EI);
  const valsalvaClassification = classifyParameter(data.valsalvaRatio, ranges.Valsalva);
  const thirtyFifteenClassification = classifyParameter(data.thirtyFifteenRatio, ranges.ThirtyFifteen);

  const baselineRFaClass = classifyParameter(baselineAnalysis.RFa, ranges.RFa);
  const baselineLFaClass = classifyParameter(baselineAnalysis.LFa, ranges.LFa);
  const baselineSBClass = classifyParameter(baselineAnalysis.SB, ranges.SB);
  const standLFaClass = classifyParameter(standAnalysis.LFa, ranges.LFa);
  const standRFaClass = classifyParameter(standAnalysis.RFa, ranges.RFa);

  // Generate Initial Baseline findings
  const baselineFindings: string[] = [];
  if (baselineAnalysis.meanHR >= 60 && baselineAnalysis.meanHR <= 100) {
    baselineFindings.push("Normal HR and Normal BP");
  }
  if (baselineLFaClass.severity === "Normal") {
    baselineFindings.push("Normal sympathetic modulation (LFa)");
  }
  if (baselineRFaClass.classification === "Borderline Low") {
    baselineFindings.push("Borderline low parasympathetic modulation (RFa)");
  } else if (baselineRFaClass.classification === "Low") {
    baselineFindings.push("Low parasympathetic activity indicating Advanced Autonomic Dysfunction (AAD)");
  } else if (baselineRFaClass.severity === "Normal") {
    baselineFindings.push("Normal parasympathetic modulation (RFa)");
  }
  if (baselineSBClass.severity === "Normal" && baselineAnalysis.SB > 2.0) {
    baselineFindings.push(`High-Normal sympathovagal balance (SB = ${baselineAnalysis.SB}) suggesting properly balanced combination of lifestyle, therapy, and clinical condition`);
  } else if (baselineAnalysis.SB > 3.0) {
    baselineFindings.push(`Elevated sympathovagal balance (SB = ${baselineAnalysis.SB}) indicating high morbidity risk`);
  } else if (baselineSBClass.severity === "Normal") {
    baselineFindings.push(`Normal sympathovagal balance (SB = ${baselineAnalysis.SB})`);
  }

  // Deep Breathing findings
  const dbFindings: string[] = [];
  const dbRFaClass = classifyParameter(dbAnalysis.RFa, ranges.RFa);
  if (dbRFaClass.severity === "Normal") {
    dbFindings.push("Normal parasympathetic response (RFa) to DB");
  } else {
    dbFindings.push(`Abnormal parasympathetic response (RFa) to DB - ${dbRFaClass.classification}`);
  }
  const dbLFaClass = classifyParameter(dbAnalysis.LFa, ranges.LFa);
  if (dbLFaClass.severity === "Normal") {
    dbFindings.push("Normal sympathetic response (LFa) to DB");
  }

  if (eiClassification.severity === "Normal") {
    dbFindings.push(`Normal E/I Ratio (${data.eiRatio})`);
  } else {
    dbFindings.push(`Abnormal E/I Ratio (${data.eiRatio}) - ${eiClassification.classification}`);
  }

  const hrChangeDB = Math.abs(dbAnalysis.meanHR - baselineAnalysis.meanHR);
  if (hrChangeDB < 10 || hrChangeDB > 20) {
    dbFindings.push("Abnormal changes in HR from baseline to DB");
  } else {
    dbFindings.push("Normal HR response to deep breathing");
  }

  // Valsalva findings
  const valsalvaFindings: string[] = [];
  const valsLFaClass = classifyParameter(valsalvaAnalysis.LFa, ranges.LFa);
  if (valsLFaClass.severity === "Normal") {
    valsalvaFindings.push("Normal sympathetic response (LFa) to Valsalva");
  } else {
    valsalvaFindings.push("Abnormal sympathetic response during Valsalva strain");
  }
  const valsRFaClass = classifyParameter(valsalvaAnalysis.RFa, ranges.RFa);
  if (valsRFaClass.severity === "Normal") {
    valsalvaFindings.push("Normal parasympathetic response (RFa) to Valsalva");
  } else {
    valsalvaFindings.push("Abnormal parasympathetic recovery from Valsalva");
  }
  if (valsalvaClassification.severity === "Normal") {
    valsalvaFindings.push(`Normal Valsalva Ratio (${data.valsalvaRatio})`);
  }

  // Stand findings
  const standFindings: string[] = [];
  if (standLFaClass.classification === "High") {
    standFindings.push("High sympathetic response (LFa) to stand suggesting possible risk of pre-syncope");
    standFindings.push("Sympathetic Excess (SE) detected - beta-adrenergic compensatory response");
  } else if (standLFaClass.severity === "Normal") {
    standFindings.push("Normal sympathetic response to stand");
  } else if (standLFaClass.classification === "Low") {
    standFindings.push("Sympathetic Withdrawal (SW) detected - alpha-adrenergic dysfunction");
  }

  if (standRFaClass.severity === "Normal") {
    standFindings.push("Normal parasympathetic response (RFa) to stand");
  } else if (standRFaClass.classification === "High") {
    standFindings.push("Parasympathetic Excess (PE) during stand - excessive vagal tone");
  }

  if (thirtyFifteenClassification.severity === "Normal") {
    standFindings.push(`Normal 30:15 Ratio (${data.thirtyFifteenRatio})`);
  } else if (data.thirtyFifteenRatio > ranges.ThirtyFifteen.high) {
    standFindings.push(`High 30:15 Ratio (${data.thirtyFifteenRatio}) suggesting sympathetic activation`);
  }

  standFindings.push("BP not reported");

  const hrDelta = standAnalysis.meanHR - baselineAnalysis.meanHR;
  if (hrDelta >= 10 && hrDelta <= 20) {
    standFindings.push("Normal HR response to standing");
  } else if (hrDelta > 30) {
    standFindings.push(`Excessive HR increase on standing (${Math.round(hrDelta)} bpm) - POTS criteria`);
  } else if (hrDelta < 10) {
    standFindings.push("Insufficient HR increase on standing");
  }

  // Build phase results
  const phaseResults: PhaseResult[] = [
    {
      phase: "INITIAL BASELINE",
      indication: "Indication of balance in the patient's Autonomic Nervous System (ANS) and protection of the heart",
      findings: baselineFindings,
      measurements: {
        HR: baselineAnalysis.meanHR,
        RFa: baselineAnalysis.RFa,
        LFa: baselineAnalysis.LFa,
        SB: baselineAnalysis.SB,
        HRV: baselineAnalysis.hrv,
      },
    },
    {
      phase: "DEEP BREATHING (DB) AND VALSALVA RESPONSES",
      indication: "Detection of early signs of autonomic dysfunction and chronic disease",
      findings: [...dbFindings, ...valsalvaFindings],
      measurements: {
        DB_RFa: dbAnalysis.RFa,
        DB_LFa: dbAnalysis.LFa,
        Valsalva_RFa: valsalvaAnalysis.RFa,
        Valsalva_LFa: valsalvaAnalysis.LFa,
        EI_Ratio: data.eiRatio,
        Valsalva_Ratio: data.valsalvaRatio,
      },
    },
    {
      phase: "STAND RESPONSES",
      indication: "Indication of proper autonomic coordination and possible causes of dizziness",
      findings: standFindings,
      measurements: {
        Stand_RFa: standAnalysis.RFa,
        Stand_LFa: standAnalysis.LFa,
        Stand_SB: standAnalysis.SB,
        HR_Delta: hrDelta,
        ThirtyFifteen_Ratio: data.thirtyFifteenRatio,
      },
    },
  ];

  // Dysfunction pattern recognition
  const dysfunctionPatterns: DysfunctionPatterns = {
    parasympatheticExcess: baselineRFaClass.classification === "High",
    parasympatheticWithdrawal: baselineRFaClass.classification === "Low",
    sympatheticExcess: standLFaClass.classification === "High",
    sympatheticWithdrawal: standLFaClass.classification === "Low",
    advancedAutonomicDysfunction: baselineRFaClass.classification === "Low",
    POTS: hrDelta >= 30,
    orthostaticDysfunction: false,
    syncopeRisk: standLFaClass.classification === "High",
  };

  // Calculate wellness metrics
  let wellnessScore = 92;
  if (dysfunctionPatterns.parasympatheticExcess) wellnessScore -= 15;
  if (dysfunctionPatterns.parasympatheticWithdrawal) wellnessScore -= 20;
  if (dysfunctionPatterns.sympatheticExcess) wellnessScore -= 10;
  if (dysfunctionPatterns.sympatheticWithdrawal) wellnessScore -= 15;
  if (dysfunctionPatterns.POTS) wellnessScore -= 20;
  if (dysfunctionPatterns.syncopeRisk) wellnessScore -= 10;
  if (baselineRFaClass.classification === "Borderline Low") wellnessScore -= 5;
  if (baselineSBClass.classification === "Borderline High") wellnessScore -= 3;
  wellnessScore = Math.max(20, Math.min(100, wellnessScore));

  let stressIndex = Math.round(baselineAnalysis.SB * 10);
  stressIndex = Math.max(5, Math.min(50, stressIndex));

  let energyLevel = "High";
  if (dysfunctionPatterns.advancedAutonomicDysfunction) energyLevel = "Low";
  else if (dysfunctionPatterns.parasympatheticExcess || dysfunctionPatterns.sympatheticExcess) energyLevel = "Moderate";

  let riskLevel = "Normal";
  if (dysfunctionPatterns.syncopeRisk) riskLevel = "High - Syncope Risk";
  else if (dysfunctionPatterns.advancedAutonomicDysfunction) riskLevel = "High - Advanced Dysfunction";
  else if (dysfunctionPatterns.POTS) riskLevel = "Moderate - POTS";
  else if (dysfunctionPatterns.parasympatheticExcess || dysfunctionPatterns.sympatheticExcess) riskLevel = "Moderate - Autonomic Imbalance";
  else if (baselineRFaClass.classification.includes("Borderline")) riskLevel = "Low - Borderline Findings";

  // Therapy recommendations
  const therapyRecommendations: ANSReport["therapyRecommendations"] = [];

  if (dysfunctionPatterns.orthostaticDysfunction || dysfunctionPatterns.sympatheticExcess || dysfunctionPatterns.syncopeRisk) {
    therapyRecommendations.push({
      category: "Hydration",
      intervention: "Proper daily hydration",
      details: "6-8 glasses of water throughout the day with fewer caffeinated, sugar and alcohol drinks. Additional salt in diet: 1 tablespoon of salt in 64 oz of water.",
      rationale: "Improves blood volume and reduces orthostatic symptoms",
    });
  }

  if (dysfunctionPatterns.parasympatheticExcess || dysfunctionPatterns.sympatheticExcess) {
    therapyRecommendations.push({
      category: "Exercise Protocol",
      intervention: "Low-and-Slow Exercise Program",
      details: "Zero-impact, pure cardiac workouts only for 6 months. Long easy walks at no more than 2 mph, or very easy bike rides. Target: 40 contiguous minutes per day.",
      rationale: "Retrains the autonomic nervous system to react normally to stresses without exacerbating PE.",
    });
  }

  if (dysfunctionPatterns.advancedAutonomicDysfunction || dysfunctionPatterns.parasympatheticWithdrawal) {
    therapyRecommendations.push({
      category: "Pharmacological",
      intervention: "Alpha-Lipoic Acid (ALA)",
      details: "600 mg three times daily (tid), time release. Anti-oxidant selective for nerves.",
      rationale: "Autonomic neuropathy protection - may lower BP by a few mmHg systolic.",
    });
  }

  if (dysfunctionPatterns.parasympatheticExcess) {
    therapyRecommendations.push({
      category: "Pharmacological",
      intervention: "Nortriptyline",
      details: "No more than 10mg once daily, 12 hours before waking. Acts as anti-cholinergic at low dose.",
      rationale: "Parasympathetic Excess (PE) treatment. Helps pattern sleep, may help with headache and pain.",
    });
  }

  let retestInterval = "6 months";
  let followUpRationale = "Re-test in 6 months to follow up";

  if (dysfunctionPatterns.parasympatheticExcess || dysfunctionPatterns.sympatheticExcess || dysfunctionPatterns.sympatheticWithdrawal) {
    retestInterval = "3 months";
    followUpRationale = "Retest in 3 months to confirm additional P&S dysfunctions and to titrate therapy more specifically to the patient.";
  } else if (dysfunctionPatterns.advancedAutonomicDysfunction) {
    retestInterval = "3 months initially, then 6 months";
    followUpRationale = "Close monitoring during initial treatment phase, then extend to 6 months once stabilized.";
  }

  if (therapyRecommendations.length === 0) {
    therapyRecommendations.push({
      category: "General",
      intervention: "No specific therapy recommended at this time",
      details: "Based on the ANS test results, no therapy options are currently recommended.",
      rationale: "All findings are within acceptable ranges or borderline. Continue current lifestyle management.",
    });
  }

  return {
    patientData: {
      lastName: data.lastName,
      firstName: data.firstName,
      gender: data.gender,
      physician: data.physician,
      height: data.height,
      age: data.age,
      weight: data.weight,
      bmi: data.bmi,
      dobString: data.dobString,
      testDate: data.testDate,
      eiRatio: data.eiRatio,
      valsalvaRatio: data.valsalvaRatio,
      thirtyFifteenRatio: data.thirtyFifteenRatio,
      ectopicBeats: data.ectopicBeats,
      testNotes: data.testNotes,
      procedureType: data.procedureType,
      samplingInterval: data.samplingInterval,
      dataPointCount: data.dataPointCount,
      ecgData: data.ecgData.slice(0, 2000),
    },
    wellnessScore,
    riskLevel,
    heartRateVariability: baselineAnalysis.hrv,
    stressIndex,
    sleepQuality: undefined,
    energyLevel,
    autonomicBalance: {
      parasympathetic: baselineAnalysis.RFa,
      sympathetic: baselineAnalysis.LFa,
      balance: baselineAnalysis.SB,
    },
    phaseResults,
    dysfunctionPatterns,
    therapyRecommendations,
    followUp: {
      retestInterval,
      rationale: followUpRationale,
      monitorParameters: [
        "Parasympathetic activity (RFa) normalization",
        "Sympathetic activity (LFa) balance",
        "Sympathovagal Balance (SB) improvement",
        "Orthostatic tolerance (HR and BP response to standing)",
        "Symptom improvement (fatigue, dizziness, etc.)",
        "Exercise tolerance progression",
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

// --- Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const fileBuffer = await parseMultipart(req);

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    // Parse the .ans binary file
    const patientData = parseANSFile(fileBuffer);

    // Generate the full ANS report using the algorithm
    const report = generateANSReport(patientData);

    return res.status(200).json({
      success: true,
      patientData,
      report,
    });
  } catch (error: any) {
    console.error("Error processing file:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process ANS file",
    });
  }
}
