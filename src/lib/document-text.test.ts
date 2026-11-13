import { describe, expect, it } from "vitest";
import { documentText, pagesFromJson } from "./document-text";

describe("pagesFromJson", () => {
  it("leser gyldig JSON-array med sider", () => {
    const json = JSON.stringify([
      { page: 1, text: "Første side" },
      { page: 2, text: "Andre side" },
    ]);
    expect(pagesFromJson(json)).toEqual(["Første side", "Andre side"]);
  });

  it("gir tom liste for ugyldig JSON uten å kaste", () => {
    expect(() => pagesFromJson("{ikke json")).not.toThrow();
    expect(pagesFromJson("{ikke json")).toEqual([]);
  });

  it("gir tom liste for gyldig JSON som ikke er en array", () => {
    expect(pagesFromJson('{"text":"Hei"}')).toEqual([]);
  });

  it("gir tom liste for tom array", () => {
    expect(pagesFromJson("[]")).toEqual([]);
  });

  it("gir tom liste når feltet er null", () => {
    expect(pagesFromJson(null)).toEqual([]);
  });

  it("trimmer sider og dropper tomme", () => {
    const json = JSON.stringify([
      { page: 1, text: "  Hei  " },
      { page: 2, text: "   " },
      { page: 3, text: "" },
    ]);
    expect(pagesFromJson(json)).toEqual(["Hei"]);
  });
});

describe("documentText", () => {
  it("slår sammen sider fra pageTexts med tom linje", () => {
    const pageTexts = JSON.stringify([
      { page: 1, text: "Side en" },
      { page: 2, text: "Side to" },
    ]);
    expect(documentText({ pageTexts, contentText: "gammel duplikattekst" })).toBe(
      "Side en\n\nSide to",
    );
  });

  it("faller tilbake til contentText når pageTexts er ugyldig JSON", () => {
    expect(documentText({ pageTexts: "ikke json", contentText: "  Hei  " })).toBe(
      "Hei",
    );
  });

  it("faller tilbake til contentText når pageTexts er en tom array", () => {
    expect(documentText({ pageTexts: "[]", contentText: "Hei" })).toBe("Hei");
  });

  it("bruker bare contentText når pageTexts mangler", () => {
    expect(documentText({ pageTexts: null, contentText: "Hei" })).toBe("Hei");
  });

  it("gir null når begge mangler", () => {
    expect(documentText({ pageTexts: null, contentText: null })).toBeNull();
    expect(documentText({})).toBeNull();
  });
});
