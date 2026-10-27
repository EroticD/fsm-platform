import { describe, expect, it } from "vitest";
import {
  reportAcknowledgement,
  reportDisplayName,
  reportUnitSummary,
} from "./report-display";

describe("reportDisplayName", () => {
  it("bruker rapportens eget navn når det finnes", () => {
    expect(
      reportDisplayName(
        { name: "Egen rapport", templateTitle: "Maltittel", template: { title: "Enda en tittel" } },
        "Standard",
      ),
    ).toBe("Egen rapport");
  });

  it("faller tilbake til frosset malkittel og deretter levende mal", () => {
    expect(
      reportDisplayName({ name: null, templateTitle: "Maltittel" }, "Standard"),
    ).toBe("Maltittel");
    expect(
      reportDisplayName({ name: "", templateTitle: null, template: { title: "Levende mal" } }, "Standard"),
    ).toBe("Levende mal");
  });

  it("bruker standardteksten når rapporten mangler navn", () => {
    expect(reportDisplayName({}, "Standard")).toBe("Standard");
  });
});

describe("reportUnitSummary", () => {
  it("teller enheter og avvik for rapporter med enheter", () => {
    expect(
      reportUnitSummary({
        requiresUnits: true,
        units: [{ status: "GODKJENT" }, { status: "AVVIK" }],
      }),
    ).toEqual({ usesUnits: true, unitCount: 2, deviationCount: 1 });
  });

  it("teller ikke den anonyme raden som en enhet", () => {
    expect(
      reportUnitSummary({
        requiresUnits: false,
        units: [{ status: "AVVIK" }],
      }),
    ).toEqual({ usesUnits: false, unitCount: 0, deviationCount: 0 });
  });
});

describe("reportAcknowledgement", () => {
  it("rapporterer kvittering med kommentar", () => {
    const at = new Date("2026-02-03T10:00:00Z");
    expect(
      reportAcknowledgement({
        customerAcknowledgedAt: at,
        customerAcknowledgedBy: "Kunde",
        customerAcknowledgedComment: "Mottatt",
      }),
    ).toEqual({
      acknowledged: true,
      at,
      by: "Kunde",
      comment: "Mottatt",
    });
  });

  it("er ikke kvittert uten tidspunkt", () => {
    expect(reportAcknowledgement({})).toEqual({
      acknowledged: false,
      at: null,
      by: null,
      comment: null,
    });
  });
});
