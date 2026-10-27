import { describe, expect, it } from "vitest";
import { splitHighlight } from "./highlight";

describe("splitHighlight", () => {
  it("deler opp og markerer treff uten å endre teksten", () => {
    const segments = splitHighlight("Årlig service på pumpe", "service");
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Årlig service på pumpe",
    );
    expect(segments.filter((segment) => segment.match)).toEqual([
      { text: "service", match: true },
    ]);
  });

  it("matcher uten hensyn til store og små bokstaver", () => {
    const segments = splitHighlight("HMS Pumpe", "hms pumpe");
    expect(segments.filter((segment) => segment.match).map((s) => s.text)).toEqual(
      ["HMS", "Pumpe"],
    );
  });

  it("behandler spesialtegn som ren tekst", () => {
    const segments = splitHighlight("Pris (2026) .*", "(2026)");
    expect(segments.some((segment) => segment.match)).toBe(true);
    expect(segments.map((segment) => segment.text).join("")).toBe("Pris (2026) .*");
  });

  it("returnerer hele teksten når søket er tomt", () => {
    expect(splitHighlight("Pumpe", "   ")).toEqual([
      { text: "Pumpe", match: false },
    ]);
    expect(splitHighlight("", "pumpe")).toEqual([]);
  });
});
