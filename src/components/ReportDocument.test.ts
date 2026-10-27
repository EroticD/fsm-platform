import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import ReportDocument from "./ReportDocument";
import { revisionToDocumentData } from "@/lib/report-revision";

const fieldsJson = JSON.stringify([
  { id: "f1", type: "TEXT", label: "Tilstand" },
]);

async function renderText({
  name,
  requiresUnits,
  label = "",
  orderNumber,
}: {
  name?: string | null;
  requiresUnits: boolean;
  label?: string;
  orderNumber?: string | null;
}) {
  const data = {
    workOrder: {
      title: "Serviceoppdrag",
      orderNumber,
      status: "OPEN",
      scheduledFor: new Date("2026-01-02T00:00:00.000Z"),
      customer: { name: "Kunde AS" },
      templates: [{ id: "tpl1", title: "Maltittel", fieldsJson }],
    },
    reports: [
      {
        id: "r1",
        templateId: "tpl1",
        templateTitle: "Maltittel",
        name,
        requiresUnits,
        dataJson: JSON.stringify({ status: "GODKJENT" }),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        units: [
          {
            id: "u1",
            label,
            serialNumber: "SN-123",
            location: "Kjeller",
            status: "GODKJENT",
            answersJson: JSON.stringify({ f1: "Alt ok" }),
            comment: null,
          },
        ],
      },
    ],
  };

  const buffer = await renderToBuffer(
    React.createElement(ReportDocument, { data }) as never,
  );
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

describe("ReportDocument", () => {
  it("bruker rapportnavnet som seksjonsoverskrift", async () => {
    const text = await renderText({ name: "Egen rapport", requiresUnits: true, label: "Pumpe" });

    expect(text).toContain("Egen rapport");
    expect(text).not.toContain("Maltittel");
  });

  it("viser sjekkpunktene uten enhetsoverskrift når rapporten ikke bruker enheter", async () => {
    const text = await renderText({ name: "Egen rapport", requiresUnits: false });

    expect(text).toContain("Egen rapport");
    expect(text).toContain("Alt ok");
    expect(text).not.toContain("SN-123");
    expect(text).not.toContain("Kjeller");
    expect(text).not.toContain("enheter kontrollert");
    expect(text).not.toContain("Enhet:");
  });

  it("faller tilbake til malkilden når rapporten mangler eget navn", async () => {
    const text = await renderText({ name: null, requiresUnits: true, label: "Pumpe" });

    expect(text).toContain("Maltittel");
  });

  it("viser ordrenummeret i toppen av PDF-en", async () => {
    const text = await renderText({
      name: "Egen rapport",
      requiresUnits: true,
      label: "Pumpe",
      orderNumber: "ORD-42",
    });

    expect(text).toContain("ORD-42");
  });

  it("rendrer et revisjonsøyeblikksbilde uten den levende malen", async () => {
    const data = revisionToDocumentData(
      {
        title: "Serviceoppdrag",
        orderNumber: "ORD-42",
        status: "COMPLETED",
        scheduledFor: new Date("2026-01-02T00:00:00.000Z"),
        customer: { name: "Kunde AS" },
      },
      {
        id: "rev1",
        revision: 1,
        dataJson: JSON.stringify({ status: "AVVIK" }),
        unitsJson: JSON.stringify([
          {
            id: "u1",
            label: "Pumpe",
            serialNumber: "SN-999",
            location: "Kjeller",
            status: "AVVIK",
            answersJson: JSON.stringify({ f1: "Gammelt svar" }),
            comment: null,
            sortOrder: 0,
          },
        ]),
        name: "Historisk rapport",
        requiresUnits: true,
        templateSnapshotJson: fieldsJson,
        technicianName: "Kari",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    );

    const buffer = await renderToBuffer(
      React.createElement(ReportDocument, { data }) as never,
    );
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      expect(result.text).toContain("Historisk rapport");
      expect(result.text).toContain("Gammelt svar");
      expect(result.text).toContain("ORD-42");
    } finally {
      await parser.destroy();
    }
  });
});
