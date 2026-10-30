import { describe, expect, it } from "vitest";
import {
  API_DEFAULT_PAGE_SIZE,
  API_MAX_PAGE_SIZE,
  paginationMeta,
  parseApiPagination,
} from "./api-pagination";

describe("parseApiPagination", () => {
  it("bruker standardverdier når parametrene mangler", () => {
    expect(parseApiPagination("https://example.test/api/v1/x")).toEqual({
      page: 1,
      limit: API_DEFAULT_PAGE_SIZE,
      skip: 0,
    });
    expect(API_DEFAULT_PAGE_SIZE).toBe(50);
  });

  it("regner ut skip fra side og limit", () => {
    expect(
      parseApiPagination(
        new URL("https://example.test/api/v1/x?page=3&limit=20"),
      ),
    ).toEqual({ page: 3, limit: 20, skip: 40 });
  });

  it("klemmer limit til 1–100 og side til minst 1", () => {
    expect(parseApiPagination("/x?page=0&limit=0")).toEqual({
      page: 1,
      limit: 1,
      skip: 0,
    });
    expect(parseApiPagination("/x?page=-4&limit=1000")).toEqual({
      page: 1,
      limit: API_MAX_PAGE_SIZE,
      skip: 0,
    });
    expect(parseApiPagination("/x?page=2&limit=101")).toEqual({
      page: 2,
      limit: API_MAX_PAGE_SIZE,
      skip: 100,
    });
  });

  it("faller tilbake til standardverdier ved ugyldige tall", () => {
    expect(parseApiPagination("/x?page=abc&limit=xyz")).toEqual({
      page: 1,
      limit: API_DEFAULT_PAGE_SIZE,
      skip: 0,
    });
    expect(parseApiPagination("/x?page=2.9&limit=10.8")).toEqual({
      page: 2,
      limit: 10,
      skip: 10,
    });
  });
});

describe("paginationMeta", () => {
  it("beregner totalPages", () => {
    expect(paginationMeta(120, 2, 50)).toEqual({
      total: 120,
      page: 2,
      limit: 50,
      totalPages: 3,
    });
  });

  it("normaliserer negative og ugyldige verdier", () => {
    expect(paginationMeta(-5, 0, 0)).toEqual({
      total: 0,
      page: 1,
      limit: 1,
      totalPages: 0,
    });
    expect(paginationMeta(Number.NaN, Number.NaN, Number.NaN)).toEqual({
      total: 0,
      page: 1,
      limit: API_DEFAULT_PAGE_SIZE,
      totalPages: 0,
    });
    expect(paginationMeta(10, 1, 500).limit).toBe(API_MAX_PAGE_SIZE);
  });
});
