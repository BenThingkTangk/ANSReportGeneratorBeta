import { parseBinaryHeader } from "../../parseBinary.js";
import { parseVendorStoredAnalysis } from "../../vendorStored.js";

/**
 * Return a complete ECG-bearing .ans prefix with the PhysioPS stored analysis
 * summary removed. Tests use this to exercise the honest legacy/truncated-file
 * fallback without maintaining a second patient fixture or hard-coded offset.
 */
export function withoutStoredSummary(bytes: Buffer): Buffer {
  try {
    const binary = parseBinaryHeader(bytes);
    if (!binary.sampling) return bytes;
    const stored = parseVendorStoredAnalysis(bytes, binary.sampling);
    return bytes.subarray(0, stored.summaryOffset);
  } catch {
    return bytes;
  }
}
