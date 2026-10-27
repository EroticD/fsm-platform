import { describe, expect, it } from "vitest";
import { reportFormSections } from "./report-form-sections";

describe("reportFormSections", () => {
  it("skjuler resultat, status og enhetskommentar når malen ikke bruker enheter", () => {
    expect(reportFormSections(false)).toEqual({
      showOverallResult: false,
      showUnitResult: false,
      showUnitComment: false,
      showFollowUpWarning: false,
    });
  });

  it("beholder alle resultatseksjonene når malen bruker enheter", () => {
    expect(reportFormSections(true)).toEqual({
      showOverallResult: true,
      showUnitResult: true,
      showUnitComment: true,
      showFollowUpWarning: true,
    });
  });
});
