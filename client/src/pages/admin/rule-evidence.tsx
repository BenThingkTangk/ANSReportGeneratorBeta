/**
 * /admin/rule-evidence — Evidence Links manager
 *
 * Three jobs in one screen:
 *   1. Master toggle to enable/disable evidence-linked explanations.
 *   2. Browse existing rule -> source mappings.
 *   3. Create new mappings (rule_type + rule_key + source_id, optional quote).
 *
 * Roles:
 *   - super_admin & clinical_admin can create mappings + toggle.
 *   - reviewer can read only.
 *   - Anyone unauthenticated is bounced by AdminGuard.
 */
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface MappingRow {
  id: string;
  rule_type: "finding" | "phenotype" | "domain";
  rule_key: string;
  evidence_quote: string | null;
  page_ref: string | null;
  notes: string | null;
  created_at: string;
  source: {
    id: string;
    title: string;
    authors: string | null;
    year: number | null;
    publication_type: string | null;
    url: string | null;
    file_path: string | null;
    active_in_ai_analysis: boolean;
    review_status: string;
  };
}

interface SourceLite {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  review_status: string;
  active_in_ai_analysis: boolean;
}

const RULE_TYPES = ["finding", "phenotype", "domain"] as const;

// Known rule keys — shown as a dropdown but free text also allowed so new
// codes from PR1/PR2 immediately become mappable.
const KNOWN_KEYS: Record<(typeof RULE_TYPES)[number], string[]> = {
  domain: ["cardiovagal", "adrenergic", "sudomotor"],
  phenotype: [
    "orthostatic_hypotension",
    "pots_like",
    "cardiovagal_impairment",
    "adrenergic_impairment",
    "parasympathetic_withdrawal",
    "sympathetic_excess",
    "possible_can_risk",
    "insufficient_data",
  ],
  finding: [
    "ORTHO_SBP_DROP_SEVERE",
    "ORTHO_SBP_DROP_MODERATE",
    "ORTHO_SBP_DROP_MILD",
    "ORTHO_DBP_DROP_MODERATE",
    "ORTHO_DBP_DROP_MILD",
  ],
};

function RuleEvidenceInner() {
  const { session, role } = useAuth();
  const canEdit = role === "super_admin" || role === "clinical_admin";
  const canToggle = role === "super_admin";

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [evidenceEnabled, setEvidenceEnabled] = useState<boolean>(false);
  const [toggling, setToggling] = useState(false);

  // Form state
  const [ruleType, setRuleType] = useState<(typeof RULE_TYPES)[number]>("finding");
  const [ruleKey, setRuleKey] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [quote, setQuote] = useState("");
  const [pageRef, setPageRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  async function loadAll() {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [mRes, sRes, cfgRes] = await Promise.all([
        fetch("/api/admin/rule-evidence", { headers }),
        fetch("/api/admin/knowledge?status=approved&active=true&limit=100", {
          headers,
        }),
        fetch("/api/admin/settings", { headers }),
      ]);
      const mJson = await mRes.json();
      const sJson = await sRes.json();
      const cfgJson = await cfgRes.json();
      if (!mJson.success) throw new Error(mJson.error ?? "mapping fetch failed");
      if (!sJson.success) throw new Error(sJson.error ?? "source fetch failed");
      setMappings(mJson.data ?? []);
      setSources(sJson.data ?? []);
      if (cfgJson.success) {
        const flag = cfgJson.data?.map?.evidence_linked_explanations_enabled;
        setEvidenceEnabled(flag === true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  async function toggleEvidence(next: boolean) {
    if (!session?.access_token || !canToggle) return;
    setToggling(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: "evidence_linked_explanations_enabled",
          value: next,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "toggle failed");
      setEvidenceEnabled(next);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setToggling(false);
    }
  }

  async function submitMapping(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    if (!ruleKey || !sourceId) {
      setFormMsg("rule_key and source required");
      return;
    }
    setSubmitting(true);
    setFormMsg(null);
    try {
      const res = await fetch("/api/admin/rule-evidence", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rule_type: ruleType,
          rule_key: ruleKey.trim(),
          source_id: sourceId,
          evidence_quote: quote.trim() || null,
          page_ref: pageRef.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "create failed");
      setFormMsg("Mapping created.");
      setRuleKey("");
      setSourceId("");
      setQuote("");
      setPageRef("");
      setNotes("");
      await loadAll();
    } catch (e) {
      setFormMsg((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteMapping(id: string) {
    if (role !== "super_admin") return;
    if (!confirm("Remove this evidence link? Citations using it will stop appearing.")) return;
    try {
      const res = await fetch(`/api/admin/rule-evidence?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "delete failed");
      await loadAll();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: "var(--color-surface-1)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  };

  return (
    <AdminLayout title="Evidence Links">
      <div style={{ maxWidth: 1200, padding: 24 }}>
        {/* Master toggle */}
        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 16, marginBottom: 8 }}>
            Evidence-Linked Explanations
          </h2>
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: 13,
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            When enabled, report bullets show approved Knowledge Library
            citations next to the deterministic rule trace. When disabled,
            bullets carry the rule trace only and are clearly labelled as
            rule-based interpretation.
          </p>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              cursor: canToggle ? "pointer" : "not-allowed",
              opacity: canToggle ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={evidenceEnabled}
              disabled={!canToggle || toggling}
              onChange={(e) => toggleEvidence(e.target.checked)}
            />
            <span style={{ fontFamily: "var(--ps-font-mono)", fontSize: 13 }}>
              {evidenceEnabled ? "ENABLED" : "DISABLED"}
            </span>
            {!canToggle && (
              <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                (super_admin only)
              </span>
            )}
          </label>
        </section>

        {/* Create form */}
        {canEdit && (
          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 16, marginBottom: 12 }}>
              Link a rule to a source
            </h2>
            <form
              onSubmit={submitMapping}
              style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}
            >
              <label>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
                  Rule type
                </div>
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as any)}
                  style={inputStyle}
                >
                  {RULE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
                  Rule key
                </div>
                <input
                  list="known-keys"
                  value={ruleKey}
                  onChange={(e) => setRuleKey(e.target.value)}
                  placeholder={KNOWN_KEYS[ruleType][0]}
                  style={inputStyle}
                />
                <datalist id="known-keys">
                  {KNOWN_KEYS[ruleType].map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </label>

              <label style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
                  Knowledge source (approved + active only)
                </div>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">— select —</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {s.year ? ` (${s.year})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
                  Evidence quote (optional)
                </div>
                <textarea
                  value={quote}
                  onChange={(e) => setQuote(e.target.value)}
                  rows={2}
                  placeholder="Short verbatim quote from the source supporting this rule"
                  style={{ ...inputStyle, fontFamily: "var(--ps-font-mono)", fontSize: 12 }}
                />
              </label>

              <label>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
                  Page / section ref (optional)
                </div>
                <input
                  value={pageRef}
                  onChange={(e) => setPageRef(e.target.value)}
                  placeholder="e.g. p. 142, §3.2"
                  style={inputStyle}
                />
              </label>

              <label>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
                  Internal notes (optional)
                </div>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={inputStyle}
                />
              </label>

              <div style={{ gridColumn: "1 / -1" }}>
                <button type="submit" disabled={submitting} style={btnStyle}>
                  {submitting ? "Saving…" : "Create mapping"}
                </button>
                {formMsg && (
                  <span style={{ marginLeft: 12, fontSize: 12 }}>{formMsg}</span>
                )}
              </div>
            </form>
          </section>
        )}

        {/* Mappings list */}
        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 16, marginBottom: 12 }}>
            Active mappings{" "}
            <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
              ({mappings.length})
            </span>
          </h2>
          {loading && <div>Loading…</div>}
          {error && (
            <div style={{ color: "var(--color-status-risk)" }}>{error}</div>
          )}
          {!loading && mappings.length === 0 && (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
              No mappings yet. Until you link a rule to a source, every
              explanation bullet for that rule will be labelled rule-based.
            </div>
          )}
          {mappings.length > 0 && (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 11 }}>
                  <th style={th}>Rule</th>
                  <th style={th}>Source</th>
                  <th style={th}>Quote</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={td}>
                      <div style={{ fontFamily: "var(--ps-font-mono)", fontSize: 12 }}>
                        {m.rule_type}::{m.rule_key}
                      </div>
                    </td>
                    <td style={td}>
                      <div>{m.source.title}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {m.source.authors ?? "—"}
                        {m.source.year ? ` · ${m.source.year}` : ""}
                      </div>
                    </td>
                    <td style={{ ...td, maxWidth: 320 }}>
                      <div style={{ fontSize: 12, fontStyle: "italic" }}>
                        {m.evidence_quote ?? "—"}
                      </div>
                      {m.page_ref && (
                        <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {m.page_ref}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      {role === "super_admin" && (
                        <button
                          onClick={() => deleteMapping(m.id)}
                          style={{ ...btnStyle, background: "transparent", color: "var(--color-status-risk)" }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-border)",
  color: "inherit",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-brand-cyan)",
  color: "#001a2a",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13,
};

const th: React.CSSProperties = {
  padding: "8px 6px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const td: React.CSSProperties = {
  padding: "10px 6px",
  verticalAlign: "top",
};

export default function RuleEvidencePage() {
  return (
    <AdminGuard>
      <RuleEvidenceInner />
    </AdminGuard>
  );
}
