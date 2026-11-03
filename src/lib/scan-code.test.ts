import { describe, expect, it } from "vitest";
import {
  isDuplicateScan,
  normalizeScannedCode,
  parseScannedCode,
} from "./scan-code";

const token = "AbCdEfGhIjKlMnOpQrSt1234";

describe("parseScannedCode", () => {
  it("reads the equipment QR route from a full URL", () => {
    expect(
      parseScannedCode(`https://fsm.example.test/enheter/qr/${token}`),
    ).toEqual({ kind: "equipment-token", token });
  });

  it("ignores an untrusted host and only uses the path", () => {
    expect(
      parseScannedCode(`https://evil.example/enheter/qr/${token}`),
    ).toEqual({ kind: "equipment-token", token });
  });

  it("reads relative equipment, work-order and field routes", () => {
    expect(parseScannedCode(`/enheter/qr/${token}`)).toEqual({
      kind: "equipment-token",
      token,
    });
    expect(parseScannedCode("/enheter/clx1234567890")).toEqual({
      kind: "equipment-id",
      id: "clx1234567890",
    });
    expect(parseScannedCode("/oppdrag/clx1234567890")).toEqual({
      kind: "work-order-id",
      id: "clx1234567890",
    });
    expect(parseScannedCode("/mine-oppdrag/clx1234567890")).toEqual({
      kind: "work-order-id",
      id: "clx1234567890",
    });
  });

  it("does not treat fixed subpages as ids", () => {
    expect(parseScannedCode("/mine-oppdrag/kunder")).toEqual({
      kind: "invalid",
      reason: "unknown",
    });
    expect(parseScannedCode("/oppdrag/ny")).toEqual({
      kind: "invalid",
      reason: "unknown",
    });
  });

  it("normalizes work-order references to upper case", () => {
    expect(parseScannedCode("o-261103-abcd1234")).toEqual({
      kind: "work-order-reference",
      reference: "O-261103-ABCD1234",
    });
    expect(parseScannedCode("B-261103-ABC123")).toEqual({
      kind: "work-order-reference",
      reference: "B-261103-ABC123",
    });
  });

  it("reads numeric order numbers before treating them as tokens", () => {
    expect(parseScannedCode("1001234567890123")).toEqual({
      kind: "work-order-number",
      number: "1001234567890123",
    });
  });

  it("reads a bare equipment token", () => {
    expect(parseScannedCode(token)).toEqual({
      kind: "equipment-token",
      token,
    });
  });

  it("rejects empty, unsafe and unknown values", () => {
    expect(parseScannedCode("  ")).toEqual({ kind: "invalid", reason: "empty" });
    expect(parseScannedCode("javascript:alert(1)")).toEqual({
      kind: "invalid",
      reason: "unknown",
    });
    expect(parseScannedCode("https://example.test/other")).toEqual({
      kind: "invalid",
      reason: "unknown",
    });
    expect(parseScannedCode("/enheter/qr/short")).toEqual({
      kind: "invalid",
      reason: "unknown",
    });
    expect(parseScannedCode("hello world")).toEqual({
      kind: "invalid",
      reason: "unknown",
    });
  });

  it("reports oversized input instead of parsing it", () => {
    expect(parseScannedCode("A".repeat(2049))).toEqual({
      kind: "invalid",
      reason: "too-long",
    });
  });
});

describe("normalizeScannedCode", () => {
  it("trims and removes zero-width characters", () => {
    expect(normalizeScannedCode("\u200B  abc \uFEFF\n")).toBe("abc");
  });
});

describe("isDuplicateScan", () => {
  it("ignores the same code inside the window only", () => {
    const previous = { code: "abc", at: 1_000 };
    expect(isDuplicateScan(previous, "abc", 2_000)).toBe(true);
    expect(isDuplicateScan(previous, "abc", 4_000)).toBe(false);
    expect(isDuplicateScan(previous, "other", 1_100)).toBe(false);
    expect(isDuplicateScan(null, "abc", 1_100)).toBe(false);
  });
});
