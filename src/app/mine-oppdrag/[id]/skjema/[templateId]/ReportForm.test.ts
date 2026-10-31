import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "nb",
  useTranslations: () => {
    const translate = (
      key: string,
      values?: Record<string, string | number>,
    ) => (values ? `${key} ${JSON.stringify(values)}` : key);
    return translate;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("./actions", () => ({
  saveDraft: vi.fn(),
  submitReport: vi.fn(),
}));
vi.mock("@/lib/offline/draft-outbox", () => ({
  loadDraftLocally: vi.fn(async () => null),
  queueDraftForRetry: vi.fn(),
  removeOutboxForReport: vi.fn(),
  saveDraftLocally: vi.fn(),
}));
vi.mock("@/components/MarkdownEditor", () => ({ default: () => null }));
vi.mock("@/components/ImageUploadField", () => ({ default: () => null }));
vi.mock("@/components/SignaturePad", () => ({ default: () => null }));
vi.mock("@/components/ConfirmDialog", () => ({ default: () => null }));
vi.mock("@/components/ErrorBanner", () => ({ default: () => null }));

import ReportForm, { type InitialReport } from "./ReportForm";
import type { TemplateField } from "./FieldInput";

const fields: TemplateField[] = [
  { id: "f1", type: "TEXT", label: "Tilstand" },
  { id: "f2", type: "IMAGE", label: "Bilde" },
];

function render(
  overrides: Partial<Parameters<typeof ReportForm>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(ReportForm, {
      workOrderId: "wo-1",
      userId: "user-1",
      templateId: "tpl-1",
      fields,
      customerUnits: [],
      defaultUnitId: null,
      requiresUnits: true,
      workOrderStatus: "IN_PROGRESS",
      technicianName: "Ola Montør",
      defaultCustomerName: "Kari Kontakt",
      returnTo: "/mine-oppdrag/wo-1",
      ...overrides,
    }),
  );
}

function report(overrides: Partial<InitialReport> = {}): InitialReport {
  return {
    notes: "",
    technicianSignatureUrl: null,
    technicianName: null,
    customerSignatureUrl: null,
    customerName: null,
    units: [
      {
        productId: "",
        label: "Port Nord",
        serialNumber: "",
        location: "",
        status: "UNASSESSED",
        comment: "",
        answers: {},
      },
    ],
    ...overrides,
  };
}

describe("ReportForm – stegstripe og live telling", () => {
  it("gir en fast 3-stegsstripe med anker, aktivt steg og ekte telling", () => {
    const html = render({
      initialReport: report({
        units: [
          {
            productId: "",
            label: "Port Nord",
            serialNumber: "",
            location: "",
            status: "GODKJENT",
            comment: "",
            answers: {
              f1: "OK",
              f2: JSON.stringify(["/uploads/a.jpg", "/uploads/b.jpg"]),
            },
          },
        ],
      }),
    });

    expect(html).toContain('href="#sjekkpunkter"');
    expect(html).toContain('href="#bilder"');
    expect(html).toContain('href="#signer"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(
      'orders.reportForm.stepProgress {&quot;answered&quot;:2,&quot;total&quot;:2}',
    );
    expect(html).toContain(
      'title="orders.imageUpload.uploaded {&quot;count&quot;:2}"',
    );
    expect(html).toContain("0/2");
  });

  it("viser avvik, kladdestatus med tid og ingen forhåndsgodkjenning", () => {
    const html = render({
      initialDraft: report({
        units: [
          {
            productId: "",
            label: "Port Nord",
            serialNumber: "",
            location: "",
            status: "AVVIK",
            comment: "Må følges opp",
            answers: { f1: "Avvik" },
          },
        ],
      }),
      draftUpdatedAt: "2026-10-30T10:05:00.000Z",
    });

    expect(html).toContain(
      "orders.reportForm.stepDeviations {&quot;count&quot;:1}",
    );
    expect(html).toContain("orders.reportForm.stepDraftSaved");
    expect(html).toMatch(/\d{2}:\d{2}/);
  });

  it("starter enhetene som ikke vurdert – ingen stille forhåndsgodkjenning", () => {
    const html = render({ initialReport: report() });

    expect(html).toContain("orders.reportForm.overallUnassessed");
    expect(html).toContain("orders.reportForm.unassessed");
    expect(html).not.toContain("orders.reportForm.overallApproved");
  });

  it("tilbyr ikke en registrert enhet som allerede er valgt i en annen rad", () => {
    const customerUnits = [
      { id: "prod-1", model: "Port Nord", serialNumber: "SN-1", location: "Bygg A" },
      { id: "prod-2", model: "Port Sør", serialNumber: "SN-2", location: "Bygg B" },
    ];
    const html = render({
      customerUnits,
      initialReport: report({
        units: [
          {
            productId: "prod-1",
            label: "Port Nord",
            serialNumber: "SN-1",
            location: "Bygg A",
            status: "UNASSESSED",
            comment: "",
            answers: {},
          },
          {
            productId: "",
            label: "Ny enhet",
            serialNumber: "",
            location: "",
            status: "UNASSESSED",
            comment: "",
            answers: {},
          },
        ],
      }),
    });

    // Første rad beholder sitt eget valg. Andre rad får ikke tilbud om det.
    expect((html.match(/value="prod-1"/g) ?? []).length).toBe(1);
    expect((html.match(/value="prod-2"/g) ?? []).length).toBe(2);
    expect(html).toContain("orders.reportForm.unitUniqueHint");
  });

  it("rydder eldre dupliserte enhetsvalg og viser en tydelig melding", () => {
    const customerUnits = [
      { id: "prod-1", model: "Port Nord", serialNumber: "SN-1", location: "Bygg A" },
    ];
    const html = render({
      customerUnits,
      initialReport: report({
        units: [
          {
            productId: "prod-1",
            label: "Port Nord",
            serialNumber: "SN-1",
            location: "Bygg A",
            status: "UNASSESSED",
            comment: "",
            answers: {},
          },
          {
            productId: "prod-1",
            label: "Port Nord",
            serialNumber: "SN-1",
            location: "Bygg A",
            status: "UNASSESSED",
            comment: "",
            answers: {},
          },
        ],
      }),
    });

    expect((html.match(/value="prod-1"/g) ?? []).length).toBe(1);
    expect(html).toContain(
      "orders.reportForm.duplicateProductsCleared {&quot;count&quot;:1}",
    );
  });
});
describe("ReportForm – registrert enhet", () => {
  it("holder enhetsdetaljene åpne slik at registrert utstyr kan velges", () => {
    const html = render({
      customerUnits: [
        {
          id: "prod-1",
          model: "Port Nord",
          serialNumber: "PN-1",
          location: "Resepsjon",
        },
      ],
    });

    expect(html).toContain("<details open");
    expect(html).toContain('id="');
    expect(html).toContain("prod-1");
    expect(html).toContain("orders.reportForm.fromCustomerEquipment");
    expect(html.indexOf("orders.reportForm.fromCustomerEquipment")).toBeLessThan(
      html.indexOf("orders.reportForm.unitResult"),
    );
  });
});
