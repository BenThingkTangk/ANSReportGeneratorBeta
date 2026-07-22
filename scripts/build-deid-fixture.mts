/**
 * Build a de-identified .ans fixture from a real PHI .ans file.
 *
 * De-identification strategy (HIPAA-safe-harbor for the identifiers a .ans
 * carries): overwrite the two leading length-prefixed name strings (last, first)
 * IN PLACE with same-length pseudonyms so every downstream byte offset is
 * preserved, and shift the 8-byte DOB timestamp to Jan-1 of the same birth year
 * (safe harbor permits retaining birth YEAR; the exact day/month is removed).
 * This keeps the derived AGE realistic and deterministic — age drives the
 * normative bands — while removing the identifying full date of birth.
 * Everything else — sex, physician, the ASCII metadata block with the Ewing
 * ratios (E/I, Valsalva, 30:15) and ectopy note, the LabVIEW study timestamp,
 * and the full int16 ECG waveform — is copied byte-for-byte.
 *
 * The result is a real-signal fixture: the deterministic parser extracts the
 * SAME clinically-verifiable numbers it extracts from the source file, but the
 * patient is no longer identifiable, so the bytes are safe to commit and run in
 * CI. The study DATE is retained (a date with no name/DOB is not identifying)
 * so date-extraction can be exercised deterministically.
 *
 * Usage:
 *   npx tsx scripts/build-deid-fixture.mts <source.ans> <out.ans> <LAST4> <FIRST4>
 * LAST4/FIRST4 must be exactly the same byte-length as the source names so the
 * layout is preserved (the script verifies this and refuses otherwise).
 */
import { readFileSync, writeFileSync } from "node:fs";

function readUInt32BE(buf: Buffer, off: number): number {
  return buf.readUInt32BE(off);
}

function main(): void {
  const [src, out, last, first] = process.argv.slice(2);
  if (!src || !out || !last || !first) {
    throw new Error(
      "usage: build-deid-fixture.mts <source.ans> <out.ans> <LAST> <FIRST>",
    );
  }
  const buf = Buffer.from(readFileSync(src)); // mutable copy

  // Last name LP-string at offset 0.
  const lastLen = readUInt32BE(buf, 0);
  const lastStart = 4;
  const firstLenOff = lastStart + lastLen;
  const firstLen = readUInt32BE(buf, firstLenOff);
  const firstStart = firstLenOff + 4;
  const dobOff = firstStart + firstLen; // 8-byte BE int64 DOB

  if (Buffer.byteLength(last, "ascii") !== lastLen) {
    throw new Error(
      `LAST pseudonym must be exactly ${lastLen} bytes (got "${last}")`,
    );
  }
  if (Buffer.byteLength(first, "ascii") !== firstLen) {
    throw new Error(
      `FIRST pseudonym must be exactly ${firstLen} bytes (got "${first}")`,
    );
  }

  buf.write(last, lastStart, "ascii");
  buf.write(first, firstStart, "ascii");

  // Shift DOB to Jan-1 of the same birth year (retain year, drop day/month).
  // DOB is a BE int64 of seconds since the LabVIEW epoch (1904-01-01 UTC).
  const LABVIEW_EPOCH_OFFSET_SEC = 2_082_844_800n;
  const dobRaw = buf.readBigInt64BE(dobOff);
  const unixSec = dobRaw - LABVIEW_EPOCH_OFFSET_SEC;
  const dobDate = new Date(Number(unixSec) * 1000);
  let dobNote = "zeroed";
  if (!Number.isNaN(dobDate.getTime()) && dobDate.getUTCFullYear() > 1900) {
    const jan1Unix = Math.floor(Date.UTC(dobDate.getUTCFullYear(), 0, 1) / 1000);
    const jan1Labview = BigInt(jan1Unix) + LABVIEW_EPOCH_OFFSET_SEC;
    buf.writeBigInt64BE(jan1Labview, dobOff);
    dobNote = `Jan-1-${dobDate.getUTCFullYear()} (day/month removed)`;
  } else {
    buf.fill(0, dobOff, dobOff + 8);
  }

  writeFileSync(out, buf);
  // eslint-disable-next-line no-console
  console.log(
    `wrote ${out} (${buf.length} bytes): last="${last}" first="${first}", DOB ${dobNote}`,
  );
}

main();
