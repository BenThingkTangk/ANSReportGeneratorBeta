# How to add a new label / synonym to the deterministic .ans parser

The parser uses two synonym tables to decode ASCII text inside `.ans` files:

| Table                  | What it maps                                              | File                     |
| ---------------------- | --------------------------------------------------------- | ------------------------ |
| `SECTION_HEADINGS`     | Section labels (e.g. `Baseline`, `Deep Breathing`)        | `api/_ans/synonyms.ts`   |
| `FIELD_SYNONYMS`       | Per-field labels (e.g. `HR`, `Heart Rate`, `Pulse`)       | `api/_ans/synonyms.ts`   |
| `SYMPTOM_KEYWORDS`     | Free-text symptom phrases that map to a canonical key     | `api/_ans/synonyms.ts`   |
| `PATTERN_LABELS`       | Diagnostic pattern abbreviations (PE, PW, SE, SW, etc.)   | `api/_ans/synonyms.ts`   |

Every label is matched **case-insensitively** and is anchored on a word
boundary on either side, so `HR` will never match inside `HRV`.

---

## Add a new label for an existing field

The most common case. Example: a new firmware version writes `R-R Heart Rate`
instead of `Heart Rate`.

1. Open `api/_ans/synonyms.ts`.
2. Find the `FIELD_SYNONYMS` entry for the field. For heart rate that's
   `FIELD_SYNONYMS.HEART_RATE`.
3. Insert the new label **at the right priority position**:
   - Earlier in the `labels` array = higher priority.
   - List the **most specific** phrasings first so longer phrases win the scan.

```ts
HEART_RATE: {
  key: "phase.heartRate",
  labels: [
    "R-R Heart Rate",  // <-- new, most specific
    "Heart Rate",
    "HR",
    "Pulse",
  ],
  valuePattern: NUMBER_PATTERN,
  unitPattern: "bpm",
},
```

4. Run the tests:

```bash
npm run test:ans
```

If you accidentally introduced a collision with another field's label, the
tests will tell you immediately.

---

## Add a brand-new field

1. Pick a canonical key. Look at `shared/ansStudy.ts` to see the existing
   shape. New scalars usually go inside a `PhaseBlock`, `AnsRatios`, or
   `AnsDemographics`. If you need a new top-level field, add it there first
   (with a `ProvField<T>`).
2. Add an entry to `FIELD_SYNONYMS`:

```ts
NEW_FIELD: {
  key: "phase.newField",                 // dotted path into AnsStudy
  labels: ["Long Phrase", "Short", "Abbrev"],
  valuePattern: NUMBER_PATTERN,          // or INT_PATTERN, or a custom regex
  unitPattern: "bpm",                    // optional
},
```

3. Wire it up in `api/_ans/parseStudy.ts`. The pattern looks like:

```ts
const newField = toProvNumber(
  extractFromSection(section, FIELD_SYNONYMS.NEW_FIELD),
  sectionId,
);
```

4. Add validation in `api/_ans/validators.ts` if the field has a plausible
   range. Update the `PLAUSIBLE` table and call `validateRange()` on the
   extracted field.
5. Add a unit test in `api/_ans/__tests__/parseStudy.spec.ts` using
   `buildSyntheticAns({ asciiBlock: "Long Phrase: 42" })`.
6. Run `npm run test:ans`.

---

## Add a new section heading

Example: a future device emits `Tilt-Back Recovery` as its own section.

1. Open `api/_ans/synonyms.ts`.
2. Decide whether this maps to an **existing** `AnsSectionId` (e.g. just
   another way of saying `tilt`) or whether it needs a new id.
   - For the simple case (existing id), add a regex to the matching array:

```ts
tilt: [
  /\bTilt(?:\s+Table)?\b/i,
  /\bHead[\-\s]?Up\s+Tilt\b/i,
  /\bHUT\b/i,
  /\bTilt[\-\s]?Back\s+Recovery\b/i,   // <-- new
],
```

   - For a brand-new id, add it to the `AnsSectionId` union in
     `shared/ansStudy.ts`, then add an entry to `SECTION_HEADINGS` and (if
     applicable) update `buildPhase()` callers in `parseStudy.ts`.
3. Run `npm run test:ans`.

---

## Rules of the road

- **Never** add a label inside `FIELD_SYNONYMS` that's also a section
  heading. The sectionizer runs first and will eat the text before the field
  extractor sees it.
- **Order matters** inside each `labels` array. Long, specific phrases must
  come before short ambiguous ones.
- **Never substitute values** for missing fields. If a value can't be found,
  the parser returns `value: null` and downstream scoring decides what to do.
- **Provenance is mandatory.** Every value you emit must carry a
  `FieldProvenance` so the UI can show where it came from and how confident
  the parser is.
- **Add a test** for every new synonym. The test suite is the only place
  collisions surface.

---

## Tooling

| Command              | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run test:ans`   | One-shot Vitest run over the .ans parser    |
| `npm run test:ans:watch` | Vitest in watch mode                    |

Real-fixture smoke tests live in `api/_ans/__tests__/smoke.mjs` and
`adapter_smoke.mjs` — run them with `npx tsx <path>`.

---

## Where the deterministic guarantees come from

- **Patient identifiers** come from length-prefixed binary strings at known
  offsets — never inferred.
- **DOB** comes from a LabVIEW int64 (seconds since 1904-01-01 UTC) at a
  known offset — never guessed from a byte-scan or filename.
- **Study date** comes from a LabVIEW int64 anywhere in the pre-data window;
  ties are broken by matching the date in the filename. Falls back to the
  filename when no timestamp is present.
- **ECG sampling** is located by scanning for a (BE double in
  [0.001 s, 0.025 s], BE uint32 ≥ 100) pair within the first 16 KB. No fixed
  offset is used, because firmware versions shift the header by ~12 bytes.

Each of these is unit-tested against both the Pare/Alex 2024-07-11 fixture
and the Francey/Shannon 2025-10-24 fixture. When you add a new fixture, drop
it into `fixtures/` and add a corresponding test block in
`parseStudy.spec.ts`.
