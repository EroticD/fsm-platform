import { describe, expect, it } from "vitest";
import { cleanSearchSnippet } from "./clean-snippet";

describe("cleanSearchSnippet", () => {
  it("fjerner highlight-markering og slår sammen mellomrom", () => {
    expect(cleanSearchSnippet("  <b>Pumpe</b>   byttet\n")).toBe("Pumpe byttet");
  });

  it("rydder JSON-fragmenter fra rapportens sjekkpunkt-svar", () => {
    expect(
      cleanSearchSnippet(
        '"value":"Pumpe byttet","comment":null,"unitId":"unit-1"',
      ),
    ).toBe("Pumpe byttet unit-1");
  });

  it("håndterer escape-tegn og unicode", () => {
    expect(
      cleanSearchSnippet('{"answer":"Trykk \\u00e5pnet\\nOK","ok":true}'),
    ).toBe("Trykk åpnet OK");
  });

  it("rører ikke vanlig tekst med anførselstegn", () => {
    expect(cleanSearchSnippet('Han sa "pumpen" virker.')).toBe(
      'Han sa "pumpen" virker.',
    );
  });

  it("gir tom streng for tomme verdier", () => {
    expect(cleanSearchSnippet(null)).toBe("");
    expect(cleanSearchSnippet("   ")).toBe("");
  });
});
