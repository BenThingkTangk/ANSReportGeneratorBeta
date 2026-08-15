/**
 * Client-side draft state for AI explanations.
 *
 * There is no report-draft persistence API in this application. These helpers
 * therefore model a deliberately session-only clinician review draft; callers
 * must never thread it to a patient component or upload response.
 */
export type ClinicalAiDraftStatus = "draft" | "approved";

export interface ClinicalAiDraft {
  text: string;
  status: ClinicalAiDraftStatus;
  createdAt: string;
  approvedAt: string | null;
  /** Explicitly prevents this state from being mistaken for durable storage. */
  storage: "session_only";
  /** The client has no path that makes this draft patient-visible. */
  patientVisible: false;
}

export function createClinicalAiDraft(text: string, now = new Date()): ClinicalAiDraft {
  return {
    text,
    status: "draft",
    createdAt: now.toISOString(),
    approvedAt: null,
    storage: "session_only",
    patientVisible: false,
  };
}

export function approveClinicalAiDraft(
  draft: ClinicalAiDraft,
  now = new Date(),
): ClinicalAiDraft {
  return {
    ...draft,
    status: "approved",
    approvedAt: now.toISOString(),
    patientVisible: false,
  };
}

