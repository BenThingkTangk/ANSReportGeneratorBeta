/**
 * Client safety boundary: mounting any portal must not call /api/synopsis, and
 * patient rendering has no path to an unapproved AI draft.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClinicalAiDraft, approveClinicalAiDraft } from "../lib/clinicalAiDraft";
import { ClinicianSynopsis } from "../components/clinician/ClinicianSynopsis";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("AI draft approval boundary", () => {
  const patient = read("client/src/components/PatientPortalTwoColumn.tsx");
  const olderPatient = read("client/src/components/patient/PatientPortal.tsx");
  const clinician = read("client/src/components/ClinicianPortalLive.tsx");
  const olderClinician = read("client/src/components/clinician/ClinicianPortal.tsx");
  const synopsis = read("client/src/components/clinician/ClinicianSynopsis.tsx");

  it("does not generate AI text automatically in either current or older portal", () => {
    for (const source of [patient, olderPatient]) {
      expect(source).not.toContain("/api/synopsis");
      expect(source).not.toContain("useEffect");
    }
    for (const source of [clinician, olderClinician]) {
      expect(source).not.toContain("useEffect");
      expect(source).toContain("generateAiDraft");
    }
    expect(synopsis).toContain('data-testid="generate-ai-draft"');
  });

  it("models saved in-session drafts with explicit approval timestamps", () => {
    const created = createClinicalAiDraft("draft explanation", new Date("2026-08-15T14:00:00.000Z"));
    expect(created).toEqual({
      text: "draft explanation",
      status: "draft",
      createdAt: "2026-08-15T14:00:00.000Z",
      approvedAt: null,
      storage: "session_only",
      patientVisible: false,
    });
    const approved = approveClinicalAiDraft(created, new Date("2026-08-15T14:05:00.000Z"));
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe("2026-08-15T14:05:00.000Z");
    expect(approved.patientVisible).toBe(false);
  });

  it("keeps generated text in clinician-only draft state until explicit approval", () => {
    for (const source of [clinician, olderClinician]) {
      expect(source).toContain("const [aiDraft, setAiDraft]");
      expect(source).toContain('aiDraft?.status === "approved" ? aiDraft.text : deterministicSynopsis');
      expect(source).toContain("createClinicalAiDraft");
      expect(source).toContain("approveClinicalAiDraft");
    }
    expect(synopsis).toContain('data-testid="approve-ai-draft"');
    expect(synopsis).toContain("Saved as clinician review draft");
    expect(synopsis).toContain("session-only, not patient-visible");
  });

  it("renders a saved draft review state without rendering unapproved draft text", async () => {
    const { fireEvent, render, screen } = await import("@testing-library/react");
    const approve = vi.fn();
    const draft = createClinicalAiDraft("UNAPPROVED AI TEXT MUST NOT RENDER");
    render(
      <ClinicianSynopsis
        synopsis="Deterministic clinician synopsis"
        loading={false}
        error={null}
        onRetry={() => undefined}
        aiDraft={draft}
        onApproveAiDraft={approve}
      />,
    );
    expect(screen.getByTestId("ai-draft-review-state").textContent).toMatch(/Saved as clinician review draft/i);
    expect(screen.queryByText("UNAPPROVED AI TEXT MUST NOT RENDER")).toBeNull();
    fireEvent.click(screen.getByTestId("approve-ai-draft"));
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("does not expose an AI-draft prop or synopsis endpoint in patient rendering", () => {
    for (const source of [patient, olderPatient]) {
      expect(source).not.toMatch(/\baiDraft\b/);
      expect(source).not.toContain("AI draft explanation");
    }
  });
});
