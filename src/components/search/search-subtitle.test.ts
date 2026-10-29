import { describe, expect, it } from "vitest";
import {
  formatSearchSubtitle,
  localizeSearchText,
} from "./search-subtitle";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

describe("localizeSearchText", () => {
  it("formaterer rene ISO-datoer etter språk", () => {
    expect(localizeSearchText("2026-10-19", "nb")).toBe("19. okt. 2026");
    expect(localizeSearchText("2026-10-19", "en")).toBe("19 Oct 2026");
  });

  it("formaterer dato og klokkeslett", () => {
    expect(localizeSearchText("2026-10-19T14:30:00.000Z", "nb")).toContain(
      "19. okt. 2026",
    );
  });

  it("renser JSON og lar vanlig tekst stå", () => {
    expect(localizeSearchText('"value":"Pumpe byttet"', "nb")).toBe(
      "Pumpe byttet",
    );
    expect(localizeSearchText("Pumpe byttet", "nb")).toBe("Pumpe byttet");
  });
});

describe("formatSearchSubtitle", () => {
  it("oversetter nøkler og lokaliserer dato-deler", () => {
    expect(
      formatSearchSubtitle(
        {
          subtitleParts: [
            { text: "Kunde AS" },
            { text: "2026-10-19" },
            { key: "components.search.statuses.COMPLETED" },
          ],
        },
        t,
        "nb",
      ),
    ).toBe(
      "Kunde AS • 19. okt. 2026 • components.search.statuses.COMPLETED",
    );
  });

  it("bruker enkel nøkkel når deler mangler", () => {
    expect(
      formatSearchSubtitle({ subtitleKey: "a.b" }, t, "nb"),
    ).toBe("a.b");
  });
});
