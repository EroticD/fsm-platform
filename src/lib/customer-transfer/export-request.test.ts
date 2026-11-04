import { describe, expect, it } from "vitest";
import {
  exportRateLimitKey,
  exportRequestFingerprint,
  normaliseExportOptions,
} from "./export-request";

const base = {
  customerIds: ["c2", "c1", "c1"],
  includeFiles: true,
  includeDeleted: false,
  includeLegalHold: false,
  includeAudit: true,
  includeSignatures: false,
};

describe("normaliseExportOptions", () => {
  it("fjerner duplikater og sorterer kunde-id-er", () => {
    expect(normaliseExportOptions(base).customerIds).toEqual(["c1", "c2"]);
  });

  it("bruker samme standardvalg som API-ruten", () => {
    expect(normaliseExportOptions({ customerIds: ["c1"] })).toEqual({
      customerIds: ["c1"],
      includeFiles: true,
      includeDeleted: false,
      includeLegalHold: false,
      includeAudit: true,
      includeSignatures: false,
    });
  });
});

describe("exportRequestFingerprint", () => {
  it("er stabil for samme bestilling uansett rekkefølge og duplikater", () => {
    const left = normaliseExportOptions(base);
    const right = normaliseExportOptions({
      ...base,
      customerIds: ["c1", "c2"],
    });
    expect(exportRequestFingerprint(left)).toBe(
      exportRequestFingerprint(right),
    );
  });

  it("endres når kundesettet eller et valg endres", () => {
    const baseOptions = normaliseExportOptions(base);
    const fingerprint = exportRequestFingerprint(baseOptions);
    expect(
      exportRequestFingerprint(
        normaliseExportOptions({ ...base, customerIds: ["c1"] }),
      ),
    ).not.toBe(fingerprint);
    expect(
      exportRequestFingerprint(
        normaliseExportOptions({ ...base, includeSignatures: true }),
      ),
    ).not.toBe(fingerprint);
  });
});

describe("exportRateLimitKey", () => {
  it("er versjonert slik at gamle tellere ikke blokkerer nye forsøk", () => {
    expect(exportRateLimitKey("admin-1")).toBe(
      "customer-transfer-export:v2:admin-1",
    );
    expect(exportRateLimitKey("admin-1")).not.toContain(
      "customer-transfer-export:admin-1",
    );
  });
});
