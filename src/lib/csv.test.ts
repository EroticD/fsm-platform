import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("escaper anførselstegn og semikolon", () => {
    expect(csvCell('Hei "på" deg')).toBe('"Hei ""på"" deg"');
    expect(csvCell("a;b")).toBe('"a;b"');
  });

  it("nøytraliserer formler", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    );
    expect(csvCell("+123")).toBe('"\'+123"');
    expect(csvCell("-123")).toBe('"\'-123"');
    expect(csvCell("@SUM(A1)")).toBe('"\'@SUM(A1)"');
    expect(csvCell("\t=1+1")).toBe('"\'\t=1+1"');
    expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
  });

  it("lar vanlig tekst være uendret", () => {
    expect(csvCell("Servicerapport")).toBe('"Servicerapport"');
    expect(csvCell(null)).toBe('""');
  });
});

describe("toCsv", () => {
  it("lager BOM, header og semikolonseparerte rader", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"A";"B"');
    expect(csv).toContain('"1";"2"');
  });
});
