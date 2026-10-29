import { describe, expect, it } from "vitest";
import { neutralizeUrls } from "./neutralize-urls";

describe("neutralizeUrls", () => {
  it("fjerner http- og https-adresser", () => {
    expect(neutralizeUrls("Se https://evil.test/logg-inn")).toBe(
      "Se [lenke fjernet]",
    );
    expect(neutralizeUrls("http://evil.test")).toBe("[lenke fjernet]");
  });

  it("fjerner www-adresser", () => {
    expect(neutralizeUrls("Gå til www.evil.test nå")).toBe(
      "Gå til [lenke fjernet] nå",
    );
  });

  it("fjerner bare domener og stier", () => {
    expect(neutralizeUrls("Sjekk evil.test/path?x=1")).toBe(
      "Sjekk [lenke fjernet]",
    );
    expect(neutralizeUrls("kari@evil.test")).toBe("kari@[lenke fjernet]");
  });

  it("beholder vanlig tekst og interne stier", () => {
    expect(neutralizeUrls("Åpne /oppdrag/wo1 for detaljer")).toBe(
      "Åpne /oppdrag/wo1 for detaljer",
    );
    expect(neutralizeUrls("Ingen lenker her")).toBe("Ingen lenker her");
  });

  it("kan bruke tom erstatning der teksten skal være en ren etikett", () => {
    expect(neutralizeUrls("Kunde AS https://evil.test", "")).toBe("Kunde AS ");
  });
});
