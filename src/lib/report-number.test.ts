import { describe, expect, it } from "vitest";
import {
  REPORT_NUMBER_PATTERN,
  generateReportNumber,
  isReportNumber,
} from "./report-number";

describe("rapportnummer", () => {
  it("genererer tre små bokstaver og fire tall", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateReportNumber()).toMatch(REPORT_NUMBER_PATTERN);
    }
  });

  it("validerer bare riktig format", () => {
    expect(isReportNumber("abc1234")).toBe(true);
    expect(isReportNumber("ABC1234")).toBe(false);
    expect(isReportNumber("ab1234")).toBe(false);
    expect(isReportNumber("abcd1234")).toBe(false);
    expect(isReportNumber("abc123")).toBe(false);
  });
});
