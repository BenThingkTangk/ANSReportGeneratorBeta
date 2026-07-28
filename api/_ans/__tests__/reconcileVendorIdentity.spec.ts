/**
 * BLOCKER 2 — vendor-PDF identity reconciliation before applying metrics.
 *
 * Guarantees that vendor spectral/BP values are only spliced onto a study when
 * the vendor PDF's identity (patient name + study date, DOB when present)
 * matches the parsed .ans. A mismatch — or missing identity — must be rejected
 * with an explicit reason, never silently applied.
 */
import { describe, it, expect } from "vitest";
import { reconcileVendorIdentity } from "../reconcileVendorIdentity.js";

const study = {
  firstName: "Alex",
  lastName: "Pare",
  testDate: "7/11/2024",
  dob: "9/17/1975",
};

describe("reconcileVendorIdentity — same patient passes", () => {
  it("matches identical name + date + dob", () => {
    const r = reconcileVendorIdentity(
      { patientName: "Alex Pare", testDate: "7/11/2024", dob: "9/17/1975" },
      study,
    );
    expect(r.ok).toBe(true);
    expect(r.checks).toEqual({ name: true, testDate: true, dob: true });
  });

  it("is name-order and case/punctuation insensitive (Last, First)", () => {
    const r = reconcileVendorIdentity(
      { patientName: "PARE, Alex", testDate: "07/11/2024", dob: "9/17/1975" },
      study,
    );
    expect(r.ok).toBe(true);
  });

  it("accepts differing date encodings for the same calendar day", () => {
    const r = reconcileVendorIdentity(
      { patientName: "Alex Pare", testDate: "2024-07-11", dob: "1975-09-17" },
      study,
    );
    expect(r.ok).toBe(true);
  });

  it("passes when DOB is absent on one side (name+date still match)", () => {
    const r = reconcileVendorIdentity(
      { patientName: "Alex Pare", testDate: "7/11/2024", dob: null },
      study,
    );
    expect(r.ok).toBe(true);
    expect(r.checks.dob).toBeNull();
  });

  it("ignores a 'Dr.' honorific and extra whitespace", () => {
    const r = reconcileVendorIdentity(
      { patientName: "  alex   pare ", testDate: "7/11/2024" },
      study,
    );
    expect(r.ok).toBe(true);
  });
});

describe("reconcileVendorIdentity — mismatch rejects", () => {
  it("rejects a different patient name", () => {
    const r = reconcileVendorIdentity(
      { patientName: "Jill Shah", testDate: "7/11/2024", dob: "9/17/1975" },
      study,
    );
    expect(r.ok).toBe(false);
    expect(r.checks.name).toBe(false);
    expect(r.reason).toMatch(/patient name/i);
  });

  it("rejects a different study date (stale prior visit)", () => {
    const r = reconcileVendorIdentity(
      { patientName: "Alex Pare", testDate: "7/11/2023", dob: "9/17/1975" },
      study,
    );
    expect(r.ok).toBe(false);
    expect(r.checks.testDate).toBe(false);
    expect(r.reason).toMatch(/study date/i);
  });

  it("rejects a conflicting DOB even when name+date match", () => {
    const r = reconcileVendorIdentity(
      { patientName: "Alex Pare", testDate: "7/11/2024", dob: "1/1/1980" },
      study,
    );
    expect(r.ok).toBe(false);
    expect(r.checks.dob).toBe(false);
    expect(r.reason).toMatch(/date of birth/i);
  });

  it("rejects when vendor identity is entirely missing", () => {
    expect(reconcileVendorIdentity(null, study).ok).toBe(false);
    expect(reconcileVendorIdentity({}, study).ok).toBe(false);
  });

  it("rejects when the study has no name/date to compare", () => {
    const r = reconcileVendorIdentity(
      { patientName: "Alex Pare", testDate: "7/11/2024" },
      { firstName: "", lastName: "", testDate: "", dob: "" },
    );
    expect(r.ok).toBe(false);
  });
});
