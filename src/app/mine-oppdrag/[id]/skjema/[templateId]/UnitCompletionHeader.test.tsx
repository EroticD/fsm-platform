import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, string | number>) =>
      values ? `${key} ${JSON.stringify(values)}` : key;
    return translate;
  },
}));

import UnitCompletionHeader from "./UnitCompletionHeader";

function render(
  overrides: Partial<Parameters<typeof UnitCompletionHeader>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(UnitCompletionHeader, {
      unitNumber: 1,
      status: "UNASSESSED",
      undoAvailable: false,
      onComplete: () => {},
      onUndo: () => {},
      onRemove: () => {},
      ...overrides,
    }),
  );
}

describe("UnitCompletionHeader – manglende sjekkpunkter", () => {
  it("gjør hvert manglende punkt til en egen hopplenke", () => {
    const html = render({
      notice: {
        kind: "missing",
        count: 2,
        fields: ["Tilstand", "Tetthet"],
      },
      missingFields: [
        { id: "anker-tilstand", label: "Tilstand" },
        { id: "anker-tetthet", label: "Tetthet" },
      ],
    });

    // Én knapp per punkt, med feltnavnet synlig og et tydelig formål for
    // skjermlesere – ikke én kommaseparert tekst.
    expect(html.match(/jumpToMissingField/g)?.length).toBe(2);
    expect(html).toContain("min-h-11");
    // Hele forklaringen beholdes for skjermlesere.
    expect(html).toContain("swipeMissingAnswers");
    expect(html).toContain("sr-only");
    expect(html).not.toContain(">Tilstand, Tetthet<");
  });

  it("faller tilbake til hele setningen når ankerne mangler", () => {
    const html = render({
      notice: { kind: "missing", count: 1, fields: ["Tilstand"] },
    });

    expect(html).toContain("swipeMissingAnswers");
    expect(html).not.toContain("jumpToMissingField");
  });
});
