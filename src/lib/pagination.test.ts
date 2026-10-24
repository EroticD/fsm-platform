import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, pageWindow, parsePage } from "./pagination";

describe("parsePage", () => {
  it("faller tilbake til side 1 for ugyldige verdier", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-5")).toBe(1);
    expect(parsePage("abc")).toBe(1);
  });

  it("leser gyldige sider", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(7)).toBe(7);
  });

  it("klemmer til totalPages når den er kjent", () => {
    expect(parsePage("99", 4)).toBe(4);
    expect(parsePage("2", 4)).toBe(2);
  });
});

describe("pageWindow", () => {
  it("regner ut riktig vindu", () => {
    expect(pageWindow(1, 60, 25)).toEqual({
      page: 1,
      pageSize: 25,
      totalPages: 3,
      skip: 0,
      take: 25,
    });
    expect(pageWindow(3, 60, 25)).toMatchObject({ skip: 50, take: 25 });
  });

  it("har alltid minst én side", () => {
    expect(pageWindow(1, 0).totalPages).toBe(1);
  });

  it("klemmer for høye og lave sidetall", () => {
    expect(pageWindow(99, 10, 5).page).toBe(2);
    expect(pageWindow(0, 10, 5).page).toBe(1);
  });

  it("bruker standard sidestørrelse", () => {
    expect(pageWindow(1, 10).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});
