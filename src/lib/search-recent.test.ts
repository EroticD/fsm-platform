import { describe, expect, it } from "vitest";
import {
  addRecentSearch,
  MAX_RECENT_SEARCHES,
  parseRecentSearches,
  readRecentSearches,
  RECENT_SEARCH_STORAGE_KEY,
  writeRecentSearches,
} from "./search-recent";

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  has(key: string) {
    return this.data.has(key);
  }
}

describe("parseRecentSearches", () => {
  it("leser en gyldig liste og trimmer verdiene", () => {
    expect(parseRecentSearches('[" kunde  nr 1 ","oppdrag"]')).toEqual([
      "kunde nr 1",
      "oppdrag",
    ]);
  });

  it("ignorerer ugyldig JSON og feil typer", () => {
    expect(parseRecentSearches("ikke json")).toEqual([]);
    expect(parseRecentSearches("{}")).toEqual([]);
    expect(parseRecentSearches('["kunde", 42, null, {"q":"x"}]')).toEqual(["kunde"]);
    expect(parseRecentSearches(null)).toEqual([]);
  });

  it("fjerner duplikater uten hensyn til store/små bokstaver", () => {
    expect(parseRecentSearches('["Kunde","kunde","KUNDE","Oppdrag"]')).toEqual([
      "Kunde",
      "Oppdrag",
    ]);
  });

  it("filtrerer bort for korte og for lange søk", () => {
    const long = "a".repeat(101);
    expect(parseRecentSearches(JSON.stringify(["a", "ok", long]))).toEqual(["ok"]);
  });

  it("begrenser til maks antall nylige søk", () => {
    const input = Array.from({ length: 15 }, (_, index) => `søk ${index}`);
    expect(parseRecentSearches(JSON.stringify(input))).toHaveLength(MAX_RECENT_SEARCHES);
    expect(parseRecentSearches(JSON.stringify(input))[0]).toBe("søk 0");
  });
});

describe("addRecentSearch", () => {
  it("legger nyeste først", () => {
    expect(addRecentSearch(["gammelt"], "nytt søk")).toEqual(["nytt søk", "gammelt"]);
  });

  it("flytter et eksisterende søk til toppen i stedet for å duplisere", () => {
    expect(addRecentSearch(["kunde", "oppdrag", "utstyr"], "  OPPDRAG ")).toEqual([
      "OPPDRAG",
      "kunde",
      "utstyr",
    ]);
  });

  it("begrenser listen og ignorerer for korte søk", () => {
    const full = Array.from({ length: MAX_RECENT_SEARCHES }, (_, index) => `søk ${index}`);
    expect(addRecentSearch(full, "nytt")).toHaveLength(MAX_RECENT_SEARCHES);
    expect(addRecentSearch(full, "nytt")[0]).toBe("nytt");
    expect(addRecentSearch(["kunde"], "a")).toEqual(["kunde"]);
    expect(addRecentSearch(["kunde"], "   ")).toEqual(["kunde"]);
  });

  it("slår sammen flere mellomrom", () => {
    expect(addRecentSearch([], "  kunde   nr  1 ")).toEqual(["kunde nr 1"]);
  });
});

describe("readRecentSearches / writeRecentSearches", () => {
  it("skriver og leser listen fra storage", () => {
    const storage = new MemoryStorage();
    writeRecentSearches(["kunde", "oppdrag"], storage);
    expect(storage.getItem(RECENT_SEARCH_STORAGE_KEY)).toBe('["kunde","oppdrag"]');
    expect(readRecentSearches(storage)).toEqual(["kunde", "oppdrag"]);
  });

  it("fjerner nøkkelen når listen tømmes", () => {
    const storage = new MemoryStorage();
    writeRecentSearches(["kunde"], storage);
    writeRecentSearches([], storage);
    expect(storage.has(RECENT_SEARCH_STORAGE_KEY)).toBe(false);
    expect(readRecentSearches(storage)).toEqual([]);
  });

  it("tåler storage som kaster feil", () => {
    const broken = {
      getItem() {
        throw new Error("nei");
      },
      setItem() {
        throw new Error("nei");
      },
      removeItem() {
        throw new Error("nei");
      },
    };
    expect(readRecentSearches(broken)).toEqual([]);
    expect(() => writeRecentSearches(["kunde"], broken)).not.toThrow();
  });

  it("tåler at storage mangler", () => {
    expect(readRecentSearches(null)).toEqual([]);
    expect(() => writeRecentSearches(["kunde"], null)).not.toThrow();
  });
});
