# HumanOS ANS — Recovery & Verification Report

**Branch:** `recovery/humanos-ans-world-class`
**Base lineage:** `feat/ans-report-ui-upgrade` @ `6f5f7d1` (`fix(ask-atom): mobile launcher no longer overlays report metrics (SIXTH FINAL-QA)`)
**Date:** 2026-07-12
**Environment:** Recovered after a permissions repair. The managed clone was sparse; work was completed against the full existing repo at `/home/user/workspace/humanos-ans`.

---

## 1. Summary

The two in-progress source modifications were preserved, reviewed, and verified. The full verification suite (type-check, server tests, client tests, accuracy-lab eval, production build, and a faithful headless-browser end-to-end run against the real Vercel API handlers) passes. A recovery branch was cut from the correct safe lineage and the verified changes committed.

**No production deploy was performed** (per instruction).

---

## 2. Preserved & reviewed source changes

Two files were modified in the working tree at recovery time. Both are consistent with the surrounding code and the project's safety-gating governance.

### `api/upload.ts` — surface ECG-derived Ewing ratios as supported observations
`generateColomboReport()` now emits the **E/I ratio** (deep-breathing cardiovagal response) and the **Valsalva ratio** as explicit Deep-Breathing-phase findings. These are ECG-derived Ewing measures that are always computed from the raw recording, so they are correctly reported as *supported* observations regardless of spectral (LFa/RFa) availability — while the proprietary spectral aggregates remain gated when unavailable. The new lines read the already-classified `ratios.eiRatio` / `ratios.valsalvaRatio` objects (value, normal range, classification), so severity labelling stays a single source of truth.

### `api/ask-atom.ts` — clinical framing that qualifies substance without diluting it
The system prompt's "Language rules" were rewritten from a list of blunt string bans into audience-aware clinical framing:
- **Clinician view:** full Colombo methodology — named phase responses, LFa/RFa/SB with bpm² units, Ewing thresholds, phenotype classifications, graded treatment protocol.
- **Patient view:** plain-language translation that keeps the finding, its significance, and the recommended direction of care — simplify wording, never delete substance.
- The absolute **assessability/provenance rules remain highest priority in both modes** — the model may only speak to what was actually measured.

This is a prompt-only change; grounding behaviour is covered by the passing `askAtomGrounding` test suite (11 tests).

### Cleanup
- Removed the temporary `.probe-write-test` file left by the environment probe.

---

## 3. Verification results

All commands run against the recovered repo. Several project artifact directories (`dist/`, `eval/runs/`, `node_modules/typescript/tsbuildinfo`, `node_modules/.vite/`) are **root-owned** from the prior environment, so tooling that writes there hits `EACCES` *after* completing its actual work. Each was worked around by redirecting output to a writable path — the underlying checks all pass.

| Stage | Command | Result |
|-------|---------|--------|
| ESM import audit | `npm run audit:esm` | ✅ all relative runtime imports use explicit `.js` |
| Type check | `tsc --noEmit --incremental false` | ✅ 0 errors (root-owned `tsbuildinfo` bypassed) |
| Server/ANS tests | `npm run test:ans` | ✅ **141 passed** (15 files) |
| Client tests | `npm run test:client` | ✅ **26 passed** (5 files) |
| Accuracy-lab eval | `eval:ci` (writable runner copy) | ✅ **15/15 cases**, gate **PASSED**, **0 unsafe overclaims**, Flag F1 = 1.000 |
| Production build | `script/build.ts` (→ `/tmp/dist`) | ✅ client 3363 modules + server bundle; `node --check` clean |
| Coldstart / handler load | shim mount of all `api/*.ts` | ✅ every handler loads (no `FUNCTION_INVOCATION_FAILED`) |
| Jill safety verifier | `scripts/verify-jill-safety.mjs` | ✅ spectral/BP gated; new E/I & Valsalva findings render honestly |
| End-to-end (Playwright) | `qa/e2e-verify.mjs` | ✅ **14/14 checks**, desktop + mobile, **0 uncaught page errors** |

### End-to-end detail
A faithful host (`qa/e2e-server.mjs`) serves the built client and mounts the **real** `api/*.ts` Vercel functions (the legacy `server/routes.ts` express server does not expose `/api/parse`, so it is not a faithful production path). Playwright then drove the actual user flow with the real Jill `.ans` file:

Per viewport (desktop 1280×900, mobile 390×844):
1. App loads ✅
2. Upload → parse-review renders ✅
3. Generate → full report renders ✅
4. Clinician view non-empty ✅
5. **Patient view non-empty (no blank crash)** ✅ — the historic Patient↔Clinician blanking regression stays fixed
6. Clinician↔Patient round-trip stable ✅
7. Honest "not assessed / requires clinician review" gating copy present ✅

The new E/I / Valsalva findings and the honest evidence-by-certainty layout (Measured / Hypotheses / Missing data) were confirmed in the rendered clinician report.

### Known non-defects observed during E2E
- A `POST /api/synopsis 400` — the optional AI-narrative call has no LLM key in the harness and the E2E shim does not JSON-parse its body. The core deterministic report renders fully without it. Not a product regression.
- An SVG `<circle cy> "undefined"` console **warning** from a chart component — pre-existing, non-fatal, unrelated to the two changed files. 0 *uncaught* page errors.

---

## 4. Branch / commit / PR status

- Recovery branch `recovery/humanos-ans-world-class` created from `6f5f7d1` — the tip of the safety-hardened `feat/ans-report-ui-upgrade` lineage (contains all six FINAL-QA safety fixes).
- Committed: the two verified source changes plus the reusable E2E harness (`qa/e2e-server.mjs`, `qa/e2e-verify.mjs`).
- **Excluded from the commit:** `qa/jill-fidelity/*.png` — these screenshots render real patient report data (PHI) and must not be committed.
- **Push / PR:** the `GH_ENTERPRISE_TOKEN` for the git proxy is invalid in this environment, so push/PR could not be completed. If credentials are restored, push `recovery/humanos-ans-world-class` and open a PR against `main`. See §6.

---

## 5. Environment caveats (for the parent)

- `dist/`, `eval/`, `eval/runs/`, `node_modules/typescript/tsbuildinfo`, `node_modules/.vite/` are **root-owned**; normal `npm run build` / `eval:ci` / `tsc` fail only on their final write step. A `chown -R user:user` of these would let the stock scripts run unmodified.
- No production deploy attempted (Vercel CLI has no credentials, and deploy was out of scope).

---

## 6. Recommended next steps (once credentials are restored)

```bash
cd /home/user/workspace/humanos-ans
git push -u origin recovery/humanos-ans-world-class
gh pr create --base main --head recovery/humanos-ans-world-class \
  --title "recovery: honest Ewing-ratio findings + audience-aware Ask ATOM framing (verified)" \
  --body-file HUMANOS_ANS_RECOVERY_VERIFIED_REPORT.md
```

All gates are green; the branch is ready to push and PR the moment the proxy token is valid.
