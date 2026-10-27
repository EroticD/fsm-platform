import { describe, expect, it } from "vitest";
import {
  mergeRecentSearch,
  parseRecentSearches,
  RECENT_SEARCHES_LIMIT,
} from "./recent-searches";

describe("parseRecentSearches", () => {
  it("leser strenger og alternative objektformater", () => {
    expect(
      parseRecentSearches(
        JSON.stringify(["pumpe", { query: "HMS" }, { q: "service" }, " pumpe "]),
      ),
    ).toEqual(["pumpe", "HMS", "service"]);
  });

  it("tåler ugyldig JSON og ukjente verdier", () => {
    expect(parseRecentSearches("{ikke json")).toEqual([]);
    expect(parseRecentSearches(JSON.stringify({ query: "pumpe" }))).toEqual([]);
    expect(parseRecentSearches(JSON.stringify([1, null, { query: 42 }]))).toEqual([]);
    expect(parseRecentSearches(null)).toEqual([]);
  });
});

describe("mergeRecentSearch", () => {
  it("legger søket først og fjerner duplikater uten store/små forskjeller", () => {
    expect(mergeRecentSearch(["HMS", "pumpe"], "hms")).toEqual(["hms", "pumpe"]);
  });

  it("begrenser listen", () => {
    const items = Array.from({ length: RECENT_SEARCHES_LIMIT + 3 }, (_, i) => `søk ${i}`);
    expect(mergeRecentSearch(items, "nytt")).toHaveLength(RECENT_SEARCHES_LIMIT);
  });

  it("ignorerer tomme søk", () => {
    expect(mergeRecentSearch(["pumpe"], "   ")).toEqual(["pumpe"]);
  });
});
