import { describe, expect, it } from "vitest";
import { reportDisplayName } from "./report-display";

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
