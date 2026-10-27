import { describe, expect, it } from "vitest";
import {
  barWidthPercent,
  DEFAULT_SEARCH_ANALYTICS_DAYS,
  formatSearchCount,
  formatSearchLatency,
  formatSearchRate,
  parseSearchAnalyticsDays,
  zeroResultRate,
} from "@/lib/search-analytics-format";

describe("parseSearchAnalyticsDays", () => {
  it("godtar de tre faste valgene", () => {
    expect(parseSearchAnalyticsDays("7")).toBe(7);
    expect(parseSearchAnalyticsDays("30")).toBe(30);
    expect(parseSearchAnalyticsDays("90")).toBe(90);
  });

  it("faller tilbake til 30 dager for tomme og ukjente verdier", () => {
    expect(DEFAULT_SEARCH_ANALYTICS_DAYS).toBe(30);
    expect(parseSearchAnalyticsDays(undefined)).toBe(30);
    expect(parseSearchAnalyticsDays("")).toBe(30);
    expect(parseSearchAnalyticsDays("14")).toBe(30);
    expect(parseSearchAnalyticsDays("abc")).toBe(30);
    expect(parseSearchAnalyticsDays(["7", "90"])).toBe(7);
  });
});

describe("zeroResultRate", () => {
  it("regner andel nulltreff", () => {
    expect(zeroResultRate(5, 20)).toBe(0.25);
    expect(zeroResultRate(0, 10)).toBe(0);
  });

  it("håndterer tomme og ugyldige tall uten å dele på null", () => {
    expect(zeroResultRate(0, 0)).toBe(0);
    expect(zeroResultRate(3, 0)).toBe(0);
    expect(zeroResultRate(Number.NaN, 10)).toBe(0);
  });

  it("klemmer raten til 0–1", () => {
    expect(zeroResultRate(15, 10)).toBe(1);
    expect(zeroResultRate(-1, 10)).toBe(0);
  });
});

describe("formatering", () => {
  const NBSP = "\u00a0";

  it("formaterer prosent med norsk og engelsk desimaltegn", () => {
    expect(formatSearchRate(0.235, "nb-NO")).toBe(`23,5${NBSP}%`);
    expect(formatSearchRate(0.235, "en-GB")).toBe("23.5%");
    expect(formatSearchRate(0.25, "nb-NO")).toBe(`25${NBSP}%`);
  });

  it("formaterer antall og latens", () => {
    expect(formatSearchCount(12345, "nb-NO")).toBe(`12${NBSP}345`);
    expect(formatSearchLatency(42.6, "nb-NO")).toBe("43 ms");
    expect(formatSearchLatency(-4, "nb-NO")).toBe("0 ms");
  });

  it("viser null for ugyldige verdier", () => {
    expect(formatSearchCount(Number.NaN, "nb-NO")).toBe("0");
    expect(formatSearchRate(Number.NaN, "nb-NO")).toBe(`0${NBSP}%`);
  });
});

describe("barWidthPercent", () => {
  it("skalerer mot travleste dag", () => {
    expect(barWidthPercent(10, 10)).toBe(100);
    expect(barWidthPercent(5, 10)).toBe(50);
    expect(barWidthPercent(1, 100)).toBe(2);
  });

  it("gir null for tomme verdier og klemmer til 100", () => {
    expect(barWidthPercent(0, 10)).toBe(0);
    expect(barWidthPercent(5, 0)).toBe(0);
    expect(barWidthPercent(20, 10)).toBe(100);
    expect(barWidthPercent(Number.NaN, 10)).toBe(0);
  });
});
