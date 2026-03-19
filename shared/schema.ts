import { z } from "zod";

// ANS Patient Data parsed from .ans file
export const ansPatientDataSchema = z.object({
  lastName: z.string(),
  firstName: z.string(),
  gender: z.string(),
  physician: z.string(),
  height: z.string(),
  age: z.number(),
  weight: z.number().optional(),
  bmi: z.number().optional(),
  dobString: z.string().optional(),
  testDate: z.string().optional(),
  eiRatio: z.number(),
  valsalvaRatio: z.number(),
  thirtyFifteenRatio: z.number(),
  ectopicBeats: z.number(),
  testNotes: z.string(),
  procedureType: z.string(),
  samplingInterval: z.number(),
  dataPointCount: z.number(),
  ecgData: z.array(z.number()),
});

export type ANSPatientData = z.infer<typeof ansPatientDataSchema>;

// Classification result
export const classificationSchema = z.object({
  classification: z.enum(["Low", "Borderline Low", "Normal", "Borderline High", "High"]),
  severity: z.enum(["Abnormal", "Warning", "Normal"]),
  measuredValue: z.number(),
});

export type Classification = z.infer<typeof classificationSchema>;

// Phase analysis results
export const phaseResultSchema = z.object({
  phase: z.string(),
  indication: z.string(),
  findings: z.array(z.string()),
  measurements: z.record(z.number()).optional(),
  classifications: z.record(classificationSchema).optional(),
});

export type PhaseResult = z.infer<typeof phaseResultSchema>;

// Dysfunction patterns
export const dysfunctionPatternsSchema = z.object({
  parasympatheticExcess: z.boolean(),
  parasympatheticWithdrawal: z.boolean(),
  sympatheticExcess: z.boolean(),
  sympatheticWithdrawal: z.boolean(),
  advancedAutonomicDysfunction: z.boolean(),
  POTS: z.boolean(),
  orthostaticDysfunction: z.boolean(),
  syncopeRisk: z.boolean(),
});

export type DysfunctionPatterns = z.infer<typeof dysfunctionPatternsSchema>;

// Complete ANS Report
export const ansReportSchema = z.object({
  patientData: ansPatientDataSchema,
  wellnessScore: z.number(),
  riskLevel: z.string(),
  heartRateVariability: z.number(),
  stressIndex: z.number(),
  sleepQuality: z.number().optional(),
  energyLevel: z.string(),
  autonomicBalance: z.object({
    parasympathetic: z.number(),
    sympathetic: z.number(),
    balance: z.number(),
  }),
  phaseResults: z.array(phaseResultSchema),
  dysfunctionPatterns: dysfunctionPatternsSchema,
  therapyRecommendations: z.array(z.object({
    category: z.string(),
    intervention: z.string(),
    details: z.string(),
    rationale: z.string(),
  })),
  followUp: z.object({
    retestInterval: z.string(),
    rationale: z.string(),
    monitorParameters: z.array(z.string()),
  }),
  generatedAt: z.string(),
});

export type ANSReport = z.infer<typeof ansReportSchema>;

// API types
export const uploadResponseSchema = z.object({
  success: z.boolean(),
  patientData: ansPatientDataSchema.optional(),
  report: ansReportSchema.optional(),
  error: z.string().optional(),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;
