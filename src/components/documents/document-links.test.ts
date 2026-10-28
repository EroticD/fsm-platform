import { describe, expect, it } from "vitest";
import { resetHref, toggleTagHref } from "./document-links";

describe("resetHref", () => {
  it("fjerner søk og tag, men beholder mappen", () => {
    expect(resetHref("folder-1")).toBe("/dokumenter?folder=folder-1");
  });

  it("gir ren dokumentlenke uten mappe", () => {
    expect(resetHref(null)).toBe("/dokumenter");
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
});
