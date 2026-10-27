import { describe, expect, it } from "vitest";
import {
  reportFileNameForWorkOrder,
  reportRevisionFileName,
  safeReportFileName,
} from "./report-pdf";

const workOrder = {
  customer: { name: "Kunde AS" },
  scheduledFor: new Date("2026-01-02T00:00:00.000Z"),
  orderNumber: "ORD-42",
};

describe("reportFileNameForWorkOrder", () => {
  it("bruker rapportnavn og ordrenummer i filnavnet", () => {
    expect(reportFileNameForWorkOrder(workOrder, "Egen rapport")).toBe(
      "Kunde-AS-Egen-rapport-ORD-42-2026-01-02",
    );
  });

  it("faller tilbake til servicerapport når rapporten mangler navn", () => {
    expect(reportFileNameForWorkOrder(workOrder, null)).toContain(
      "servicerapport",
    );
  });

  it("lager et trygt filnavn også med norske tegn", () => {
    expect(safeReportFileName("Årsrapport for Øst – 2026")).toBe(
      "arsrapport-for-ost-2026",
    );
  });
});

describe("reportRevisionFileName", () => {
  it("merker revisjonen med nummer og rapportnavn", () => {
    expect(
      reportRevisionFileName(workOrder, {
        revision: 3,
        name: "Egen rapport",
        templateTitle: null,
      }),
    ).toBe("Kunde-AS-Egen-rapport-ORD-42-2026-01-02-revisjon-3");
  });
});
