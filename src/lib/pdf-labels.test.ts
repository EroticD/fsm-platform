import { describe, expect, it } from "vitest";
import { DEFAULT_PDF_LOCALE, getPdfLabels } from "./pdf-labels";

describe("getPdfLabels", () => {
  it("bruker norsk som standard", () => {
    expect(DEFAULT_PDF_LOCALE).toBe("nb");
    expect(getPdfLabels()).toBe(getPdfLabels("nb"));
    expect(getPdfLabels(null).documentTitle).toBe("Servicerapport");
    expect(getPdfLabels("uk").documentTitle).toBe("Servicerapport");
  });

  it("velger engelsk for en og varianter", () => {
    expect(getPdfLabels("en").documentTitle).toBe("Service report");
    expect(getPdfLabels("en-GB").documentTitle).toBe("Service report");
  });

  it("beholder eksakt norsk tekst for arkiverte PDF-er", () => {
    const labels = getPdfLabels("nb");
    expect(labels.footer("Kunde AS")).toBe(
      "Kunde AS – generert av FSM-plattformen",
    );
    expect(labels.unitCount(1)).toBe(" – 1 enhet kontrollert");
    expect(labels.unitCount(2)).toBe(" – 2 enheter kontrollert");
    expect(labels.reportNumberSuffix("R-1")).toBe("  •  Rapportnr. R-1");
    expect(labels.attachmentSerial("SN-1")).toBe("  •  Serienummer: SN-1");
  });
});
