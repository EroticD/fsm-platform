import { describe, expect, it } from "vitest";
import {
  resetHref,
  safeDocumentReturnTo,
  toggleTagHref,
} from "./document-links";

describe("resetHref", () => {
  it("fjerner søk og tag, men beholder mappen", () => {
    expect(resetHref("folder-1")).toBe("/dokumenter?folder=folder-1");
  });

  it("gir ren dokumentlenke uten mappe", () => {
    expect(resetHref(null)).toBe("/dokumenter");
  });

  it("beholder «kun denne mappen»", () => {
    expect(resetHref("folder-1", true)).toBe(
      "/dokumenter?folder=folder-1&scope=folder",
    );
  });

  it("beholder «hele biblioteket» inne i en mappe", () => {
    expect(resetHref("folder-1", false, true)).toBe(
      "/dokumenter?folder=folder-1&scope=library",
    );
  });
});

describe("toggleTagHref", () => {
  it("fjerner aktiv tag og beholder mappe og søk", () => {
    expect(
      toggleTagHref("Viktig", {
        folderId: "folder-1",
        searchQuery: "avtale",
        tagFilter: "Viktig",
      }),
    ).toBe("/dokumenter?folder=folder-1&q=avtale");
  });

  it("legger til inaktiv tag og beholder mappe og søk", () => {
    expect(
      toggleTagHref("Ny", {
        folderId: "folder-1",
        searchQuery: "avtale",
        tagFilter: "Viktig",
      }),
    ).toBe("/dokumenter?folder=folder-1&q=avtale&tag=Ny");
  });

  it("koder spesialtegn i søk og tag", () => {
    expect(
      toggleTagHref("HMS & miljø", {
        folderId: "folder-1",
        searchQuery: "pumpe service",
        tagFilter: "",
      }),
    ).toBe(
      "/dokumenter?folder=folder-1&q=pumpe+service&tag=HMS+%26+milj%C3%B8",
    );
  });

  it("beholder søkeomfanget når taggen slås av", () => {
    expect(
      toggleTagHref("Viktig", {
        folderId: "folder-1",
        searchQuery: "avtale",
        tagFilter: "Viktig",
        onlyFolder: true,
      }),
    ).toBe("/dokumenter?folder=folder-1&q=avtale&scope=folder");
  });

  it("beholder søk i hele biblioteket når taggen slås av", () => {
    expect(
      toggleTagHref("Viktig", {
        folderId: "folder-1",
        searchQuery: "avtale",
        tagFilter: "Viktig",
        libraryScope: true,
      }),
    ).toBe("/dokumenter?folder=folder-1&q=avtale&scope=library");
  });
});

describe("safeDocumentReturnTo", () => {
  it("godtar interne stier med søk og fragment", () => {
    expect(safeDocumentReturnTo("/sok?q=pumpe#treff")).toBe(
      "/sok?q=pumpe#treff",
    );
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/dokumenter\\..\\hemmelig",
    "sok?q=pumpe",
    "/sok\u0000",
    "",
  ])("avviser utrygge returmål: %s", (value) => {
    expect(safeDocumentReturnTo(value)).toBeNull();
  });
});
