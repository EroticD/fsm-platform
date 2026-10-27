import { describe, expect, it } from "vitest";
import {
  parseRevisionUnits,
  revisionLegacyAnswers,
  revisionToDocumentData,
  revisionToDocumentReport,
} from "./report-revision";

const revision = {
  id: "rev1",
  revision: 2,
  reason: "Rettet serienummer",
  dataJson: JSON.stringify({ status: "AVVIK", answers: { f1: "Gammelt svar" } }),
  unitsJson: JSON.stringify([
    {
      id: "u2",
      label: "Pumpe 2",
      serialNumber: "SN-2",
      location: "Kjeller",
      status: "GODKJENT",
      answersJson: JSON.stringify({ f1: "Ok" }),
      comment: null,
      sortOrder: 1,
    },
    {
      id: "u1",
      label: "Pumpe 1",
      serialNumber: "SN-1",
      location: "Tak",
      status: "AVVIK",
      answersJson: JSON.stringify({ f1: "Avvik" }),
      comment: "Må byttes",
      sortOrder: 0,
    },
  ]),
  comments: "Generell kommentar",
  templateTitle: "Maltittel",
  name: "Egen rapport",
  requiresUnits: true,
  completedAt: new Date("2026-01-02T10:00:00Z"),
  templateSnapshotJson: JSON.stringify([{ id: "f1", type: "TEXT", label: "Tilstand" }]),
  technicianSignatureUrl: "/uploads/tekniker.png",
  technicianName: "Kari",
  customerSignatureUrl: null,
  customerName: null,
  customerAcknowledgedAt: null,
  customerAcknowledgedBy: null,
  customerAcknowledgedComment: null,
  createdById: "u1",
  createdAt: new Date("2026-01-03T10:00:00Z"),
};

describe("parseRevisionUnits", () => {
  it("leser enheter, sorterer og tåler ødelagt JSON", () => {
    expect(parseRevisionUnits(revision.unitsJson).map((unit) => unit.id)).toEqual([
      "u1",
      "u2",
    ]);
    expect(parseRevisionUnits("{ikke json")).toEqual([]);
    expect(parseRevisionUnits(null)).toEqual([]);
  });
});

describe("revisionToDocumentReport", () => {
  it("bruker øyeblikksbildets navn, enheter og signaturer", () => {
    const report = revisionToDocumentReport(revision);

    expect(report.name).toBe("Egen rapport");
    expect(report.requiresUnits).toBe(true);
    expect(report.units).toHaveLength(2);
    expect(report.units[0]).toMatchObject({
      label: "Pumpe 1",
      status: "AVVIK",
      comment: "Må byttes",
    });
    expect(report.technicianSignatureUrl).toBe("/uploads/tekniker.png");
    expect(report.customerSignatureUrl).toBeNull();
  });

  it("lar en rapport uten enheter beholde de anonyme svarene", () => {
    const report = revisionToDocumentReport({
      ...revision,
      requiresUnits: false,
      unitsJson: JSON.stringify([
        {
          id: "anonym",
          label: "",
          status: "GODKJENT",
          answersJson: JSON.stringify({ f1: "Svar" }),
          comment: null,
          sortOrder: 0,
        },
      ]),
    });

    expect(report.requiresUnits).toBe(false);
    expect(report.units).toHaveLength(1);
    expect(revisionLegacyAnswers(revision)).toEqual({ f1: "Gammelt svar" });
  });
});

describe("revisionToDocumentData", () => {
  it("bygger PDF-data kun fra revisjonen, uten den levende malen", () => {
    const data = revisionToDocumentData(
      {
        id: "wo1",
        title: "Serviceoppdrag",
        orderNumber: "ORD-42",
        status: "COMPLETED",
        scheduledFor: new Date("2026-01-02T00:00:00Z"),
        customer: { name: "Kunde AS" },
      },
      revision,
    );

    expect(data.reports).toHaveLength(1);
    expect(data.reports[0].name).toBe("Egen rapport");
    expect(data.reports[0].templateSnapshotJson).toContain("Tilstand");
    expect(data.workOrder.templates).toEqual([]);
    expect(data.workOrder.orderNumber).toBe("ORD-42");
  });
});
