/**
 * /admin/accuracy-lab — ANS Accuracy Lab
 *
 * Three-pane clinician review screen for the deterministic ANS pipeline:
 *   1. Fixture list (left)     — filter by scenario, click to load
 *   2. Engine output (middle)  — raw .ans bytes summary, parsed AnsStudy JSON,
 *                                 generated DiagnosticSummary JSON
 *   3. Correction form (right) — edit expected fields/scores/flags + notes,
 *                                 submit to /api/admin/eval-correction
 *
 * Restricted to clinical_admin and super_admin.
 */

import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface FixtureLite {
  id: string;
  description: string;
  scenario: string;
  source: string;
  fileName: string;
  clinicianNotes?: string;
  createdAt: string;
}

interface FixtureDetail {
  evalCase: FixtureLite & {
    expectedFields: Record<string, unknown>;
    expectedScores: Record<string, unknown>;
    expectedFlags: Record<string, unknown>;
    ansBase64: string;
  };
  parsedStudy: unknown;
  diagnosticSummary: unknown;
  parserError: string | null;
}

interface EvalRunSummary {
  runId: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  metrics: {
    demographicsAccuracy: { ratio: number };
    numericAccuracy: { ratio: number };
    missingDetection: { ratio: number };
    abnormalityFlags: { f1: number };
    unsafeOverclaimCount: number;
  };
  caseResults: Array<{
    caseId: string;
    passed: boolean;
    failures: Array<{ category: string; code: string; message: string }>;
  }>;
}

const SCENARIOS = ["all", "normal", "abnormal", "missing", "conflicting", "low_quality", "edge_case"] as const;

const cardStyle: React.CSSProperties = {
  background: "rgba(10,17,29,0.6)",
  border: "1px solid rgba(0,229,255,0.15)",
  borderRadius: 12,
  padding: 16,
};

const codeStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(210,235,255,0.06)",
  borderRadius: 8,
  padding: 12,
  fontFamily: "var(--ps-font-mono)",
  fontSize: 11,
  color: "var(--color-text-secondary)",
  whiteSpace: "pre",
  overflow: "auto",
  maxHeight: 360,
};

export default function AccuracyLabPage() {
  const { session, role } = useAuth();
  const [list, setList] = useState<FixtureLite[]>([]);
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FixtureDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<EvalRunSummary | null>(null);
  const [running, setRunning] = useState(false);

  // Correction form state
  const [notes, setNotes] = useState("");
  const [correctedFieldsText, setCorrectedFieldsText] = useState("");
  const [correctedScoresText, setCorrectedScoresText] = useState("");
  const [correctedFlagsText, setCorrectedFlagsText] = useState("");
  const [promote, setPromote] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  async function fetchList() {
    if (!session?.access_token) return;
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/eval-cases", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "request failed");
      setList(json.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingList(false);
    }
  }

  async function fetchDetail(id: string) {
    if (!session?.access_token) return;
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/admin/eval-cases?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "request failed");
      const d = json.data as FixtureDetail;
      setDetail(d);
      setCorrectedFieldsText(JSON.stringify(d.evalCase.expectedFields, null, 2));
      setCorrectedScoresText(JSON.stringify(d.evalCase.expectedScores, null, 2));
      setCorrectedFlagsText(JSON.stringify(d.evalCase.expectedFlags, null, 2));
      setNotes("");
      setPromote(false);
      setSubmitState("idle");
      setSubmitMessage(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function runEval(caseId?: string) {
    if (!session?.access_token) return;
    setRunning(true);
    try {
      const res = await fetch("/api/admin/eval-run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(caseId ? { caseId } : {}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "run failed");
      setRunSummary(json.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function submitCorrection() {
    if (!session?.access_token || !detail) return;
    setSubmitState("saving");
    setSubmitMessage(null);
    try {
      const parsedFields = correctedFieldsText.trim() ? JSON.parse(correctedFieldsText) : undefined;
      const parsedScores = correctedScoresText.trim() ? JSON.parse(correctedScoresText) : undefined;
      const parsedFlags = correctedFlagsText.trim() ? JSON.parse(correctedFlagsText) : undefined;
      const res = await fetch("/api/admin/eval-correction", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseId: detail.evalCase.id,
          engineOutput: detail.diagnosticSummary,
          correctedFields: parsedFields,
          correctedScores: parsedScores,
          correctedFlags: parsedFlags,
          notes: notes.trim() || undefined,
          promoteToFixture: promote,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "submit failed");
      setSubmitState("ok");
      setSubmitMessage(
        json.data?.promotedCaseId
          ? `Saved. Promoted to fixture: ${json.data.promotedCaseId}`
          : `Saved correction ${json.data.id}.`,
      );
      if (promote) void fetchList();
    } catch (e) {
      setSubmitState("error");
      setSubmitMessage((e as Error).message);
    }
  }

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const filteredList = useMemo(
    () => (scenario === "all" ? list : list.filter(c => c.scenario === scenario)),
    [list, scenario],
  );

  if (role !== "super_admin" && role !== "clinical_admin") {
    return (
      <AdminGuard>
        <AdminLayout title="Accuracy Lab">
          <div
            style={{
              padding: "16px 20px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8,
              color: "var(--color-status-critical)",
              fontSize: 13,
            }}
          >
            This page is restricted to Clinical Admins and Super Admins.
          </div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <AdminLayout title="ANS Accuracy Lab">
        {/* Top bar — scenario filter + run all */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          {SCENARIOS.map(s => (
            <button
              key={s}
              onClick={() => setScenario(s)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: scenario === s ? "1px solid rgba(0,229,255,0.5)" : "1px solid rgba(210,235,255,0.1)",
                background: scenario === s ? "rgba(0,229,255,0.08)" : "rgba(10,17,29,0.6)",
                color: scenario === s ? "var(--color-accent-cyan)" : "var(--color-text-secondary)",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "var(--ps-font-mono)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {s.replace("_", " ")}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => runEval()}
            disabled={running}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(0,229,255,0.4)",
              background: "rgba(0,229,255,0.08)",
              color: "var(--color-accent-cyan)",
              cursor: running ? "not-allowed" : "pointer",
              fontSize: 12,
              opacity: running ? 0.5 : 1,
            }}
          >
            {running ? "Running…" : "Run all evals"}
          </button>
        </div>

        {/* Run summary banner */}
        {runSummary && (
          <div
            style={{
              ...cardStyle,
              marginBottom: 16,
              borderColor:
                runSummary.failedCases === 0
                  ? "rgba(34,197,94,0.4)"
                  : "rgba(239,68,68,0.4)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>
              Run {runSummary.runId.slice(0, 8)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, fontSize: 12 }}>
              <Metric label="Pass" value={`${runSummary.passedCases}/${runSummary.totalCases}`} />
              <Metric label="Demographics" value={`${(runSummary.metrics.demographicsAccuracy.ratio * 100).toFixed(1)}%`} />
              <Metric label="Numeric" value={`${(runSummary.metrics.numericAccuracy.ratio * 100).toFixed(1)}%`} />
              <Metric label="Flag F1" value={runSummary.metrics.abnormalityFlags.f1.toFixed(3)} />
              <Metric
                label="Unsafe overclaims"
                value={String(runSummary.metrics.unsafeOverclaimCount)}
                critical={runSummary.metrics.unsafeOverclaimCount > 0}
              />
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8,
              color: "var(--color-status-critical)",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 1fr", gap: 16 }}>
          {/* Fixture list */}
          <div style={cardStyle}>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Fixtures ({filteredList.length})
            </div>
            {loadingList ? (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredList.map(c => {
                  const runResult = runSummary?.caseResults.find(r => r.caseId === c.id);
                  const isSelected = selectedId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedId(c.id);
                        void fetchDetail(c.id);
                      }}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: isSelected ? "1px solid rgba(0,229,255,0.4)" : "1px solid rgba(210,235,255,0.05)",
                        background: isSelected ? "rgba(0,229,255,0.06)" : "transparent",
                        color: "var(--color-text-secondary)",
                        cursor: "pointer",
                        fontSize: 11,
                      }}
                    >
                      <div style={{ fontFamily: "var(--ps-font-mono)", fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        {runResult && (
                          <span style={{ color: runResult.passed ? "var(--color-status-optimal)" : "var(--color-status-critical)" }}>
                            {runResult.passed ? "✓" : "✗"}
                          </span>
                        )}
                        <span>{c.id}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>
                        {c.scenario}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Engine output column */}
          <div style={cardStyle}>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Engine output
            </div>
            {loadingDetail && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</div>}
            {!loadingDetail && !detail && (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Select a fixture to inspect.</div>
            )}
            {detail && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Section title="Case meta">
                  <pre style={codeStyle}>
                    {JSON.stringify(
                      {
                        id: detail.evalCase.id,
                        scenario: detail.evalCase.scenario,
                        source: detail.evalCase.source,
                        description: detail.evalCase.description,
                        fileName: detail.evalCase.fileName,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </Section>
                <Section title="Parsed AnsStudy">
                  <pre style={codeStyle}>{JSON.stringify(detail.parsedStudy, null, 2)}</pre>
                </Section>
                <Section title="Diagnostic summary">
                  <pre style={codeStyle}>{JSON.stringify(detail.diagnosticSummary, null, 2)}</pre>
                </Section>
                {detail.parserError && (
                  <Section title="Parser error">
                    <pre style={{ ...codeStyle, color: "var(--color-status-critical)" }}>{detail.parserError}</pre>
                  </Section>
                )}
                <button
                  onClick={() => runEval(detail.evalCase.id)}
                  disabled={running}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid rgba(0,229,255,0.3)",
                    background: "rgba(0,229,255,0.05)",
                    color: "var(--color-accent-cyan)",
                    cursor: running ? "not-allowed" : "pointer",
                    fontSize: 11,
                    alignSelf: "flex-start",
                  }}
                >
                  Re-run this case
                </button>
              </div>
            )}
          </div>

          {/* Correction form */}
          <div style={cardStyle}>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Clinician correction
            </div>
            {!detail ? (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Select a fixture to submit corrections.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <FormBlock label="Expected fields (JSON)" value={correctedFieldsText} onChange={setCorrectedFieldsText} />
                <FormBlock label="Expected scores (JSON)" value={correctedScoresText} onChange={setCorrectedScoresText} />
                <FormBlock label="Expected flags (JSON)" value={correctedFlagsText} onChange={setCorrectedFlagsText} />
                <label style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Why is the engine output wrong? What should it have produced?"
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(210,235,255,0.08)",
                    borderRadius: 6,
                    padding: 8,
                    color: "var(--color-text-primary)",
                    fontSize: 12,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={promote} onChange={e => setPromote(e.target.checked)} />
                  Promote to new fixture
                </label>
                <button
                  onClick={() => void submitCorrection()}
                  disabled={submitState === "saving"}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "1px solid rgba(0,229,255,0.4)",
                    background: "rgba(0,229,255,0.08)",
                    color: "var(--color-accent-cyan)",
                    cursor: submitState === "saving" ? "not-allowed" : "pointer",
                    fontSize: 12,
                    alignSelf: "flex-start",
                  }}
                >
                  {submitState === "saving" ? "Saving…" : "Save correction"}
                </button>
                {submitMessage && (
                  <div
                    style={{
                      fontSize: 11,
                      color:
                        submitState === "ok"
                          ? "var(--color-status-optimal)"
                          : "var(--color-status-critical)",
                    }}
                  >
                    {submitMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: "var(--ps-font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function FormBlock({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: "var(--ps-font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        rows={6}
        style={{
          width: "100%",
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(210,235,255,0.08)",
          borderRadius: 6,
          padding: 8,
          color: "var(--color-text-secondary)",
          fontSize: 11,
          fontFamily: "var(--ps-font-mono)",
          resize: "vertical",
        }}
      />
    </div>
  );
}

function Metric({ label, value, critical }: { label: string; value: string; critical?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
      <div
        style={{
          fontSize: 16,
          fontFamily: "var(--ps-font-mono)",
          color: critical ? "var(--color-status-critical)" : "var(--color-text-primary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
