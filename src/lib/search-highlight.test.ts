import { describe, expect, it } from "vitest";
import { highlightSearchText, searchTokens } from "./search-highlight";

describe("searchTokens", () => {
  it("deler på mellomrom og skilletegn og bretter norske tegn", () => {
    expect(searchTokens("Årlig-service, ØST")).toEqual(["arlig", "service", "ost"]);
  });

  it("håndterer tomme verdier", () => {
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens(null)).toEqual([]);
    expect(searchTokens(undefined)).toEqual([]);
  });
});

describe("highlightSearchText", () => {
  it("returnerer hele teksten uten treff når søket er tomt", () => {
    expect(highlightSearchText("Årlig service", "")).toEqual([
      { text: "Årlig service", match: false },
    ]);
  });

  it("uthever treff uten å endre original store/små bokstaver", () => {
    expect(highlightSearchText("KundeKort nr 12", "kunde")).toEqual([
      { text: "Kunde", match: true },
      { text: "Kort nr 12", match: false },
    ]);
  });

  it("matcher æ/ø/å og aksenter som søket gjør", () => {
    expect(highlightSearchText("Årlig service", "arlig")).toEqual([
      { text: "Årlig", match: true },
      { text: " service", match: false },
    ]);
    expect(highlightSearchText("Café Øl", "cafe ol")).toEqual([
      { text: "Café", match: true },
      { text: " ", match: false },
      { text: "Øl", match: true },
    ]);
  });

  it("uthever flere ord og slår sammen overlappende treff", () => {
    expect(highlightSearchText("foo bar", "o b")).toEqual([
      { text: "f", match: false },
      { text: "oo", match: true },
      { text: " ", match: false },
      { text: "b", match: true },
      { text: "ar", match: false },
    ]);

    expect(highlightSearchText("aaaa", "aa")).toEqual([
      { text: "aaaa", match: true },
    ]);
  });

  it("returnerer én umerket bit når ingenting matcher", () => {
    expect(highlightSearchText("Kunde", "xyz")).toEqual([
      { text: "Kunde", match: false },
    ]);
  });

  it("behandler HTML-lignende tekst som vanlig tekst", () => {
    expect(highlightSearchText("<b>Kunde</b>", "b")).toEqual([
      { text: "<", match: false },
      { text: "b", match: true },
      { text: ">Kunde</", match: false },
      { text: "b", match: true },
      { text: ">", match: false },
    ]);
  });

  it("håndterer tom tekst", () => {
    expect(highlightSearchText("", "kunde")).toEqual([]);
  });
});
