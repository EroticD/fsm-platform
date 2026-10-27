import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import ReportDocument from "./ReportDocument";

const fieldsJson = JSON.stringify([
  { id: "f1", type: "TEXT", label: "Tilstand" },
]);

async function renderText({
  name,
  requiresUnits,
  label = "",
}: {
  name?: string | null;
  requiresUnits: boolean;
  label?: string;
}) {
  const data = {
    workOrder: {
      title: "Serviceoppdrag",
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
});
