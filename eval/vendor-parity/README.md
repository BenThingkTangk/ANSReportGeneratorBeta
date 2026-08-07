# PhysioPS Vendor Parity Harness

This directory is the Phase 1 recovery baseline for HumanOS ANS. It compares the
canonical HumanOS `.ans` parser against an immutable, deidentified 11-case
vendor oracle derived from paired PhysioPS `.ans` files and PDF reports.

## Privacy boundary

- Raw `.ans` files are never committed.
- Local source filenames and paths are never written to reports.
- Cases are matched only by SHA-256 and reported as `Case 01` through `Case 11`.
- Patient names and dates of birth are not present in committed oracle artifacts.

## Run

```bash
ANS_VENDOR_SOURCE_ROOT=/path/to/private/ans/files npm run parity:vendor
```

Or:

```bash
npm run parity:vendor -- --source-root /path/to/private/ans/files --out /tmp/vendor-parity
```

The default command is diagnostic: it exits nonzero only for integrity or source
discovery failures. Use the strict gate when parity is expected:

```bash
ANS_VENDOR_SOURCE_ROOT=/path/to/private/ans/files npm run parity:vendor:strict
```

Strict mode exits nonzero while any comparison is `mismatch`,
`not_implemented`, or `unavailable`.

## Scope

Phase 1 measured demographics, sampling metadata and Ewing ratios. Phase 2 added
the stored six-phase numerical summary. Phase 3 adds real scored checks for the
stored visualization data: the 4 Hz heart-rate/breathing arrays, the beat-to-beat
interval series, all eleven 4-second trend arrays (offset, count, min, max, mean,
first four values), the resolved trend index-to-metric mapping, and the stored
wavelet spectrogram including a byte-exact header comparison and an exact
transport round-trip. No comparison in this harness is a placeholder.

## Status meanings

- `pass`: HumanOS matches the vendor oracle within the stated tolerance.
- `mismatch`: HumanOS emits a value, but it differs from the vendor oracle.
- `not_implemented`: the oracle proves the datum exists or is derivable, but the
  canonical HumanOS study model does not yet reproduce it.
- `unavailable`: the private source file was not found for that oracle case.

No result in this harness is a diagnosis. It is a software parity measurement.

See `PHASE1_BASELINE.md`, `PHASE2_PARSER_BASELINE.md` and
`PHASE3_VISUALIZATION_BASELINE.md` for the recorded results of each phase and for
the boundaries each phase explicitly does not claim.
