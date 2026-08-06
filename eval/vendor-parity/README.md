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

## Status meanings

- `pass`: HumanOS matches the vendor oracle within the stated tolerance.
- `mismatch`: HumanOS emits a value, but it differs from the vendor oracle.
- `not_implemented`: the oracle proves the datum exists or is derivable, but the
  canonical HumanOS study model does not yet reproduce it.
- `unavailable`: the private source file was not found for that oracle case.

No result in this harness is a diagnosis. It is a software parity measurement.
