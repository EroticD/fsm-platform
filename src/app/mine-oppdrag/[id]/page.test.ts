import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { dateOnlyInOslo, osloDayStart } from "@/lib/dates";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  workOrderFindFirst: vi.fn(),
  auditLogFindMany: vi.fn(async () => []),
  userFindMany: vi.fn(async () => []),
  templateFindMany: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "nb"),
  getTranslations: vi.fn(async () => {
    const translate = (
      key: string,
      values?: Record<string, string | number>,
    ) => (values ? `${key} ${JSON.stringify(values)}` : key);
    return translate;
  }),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/permissions", () => ({
  hasPermission: () => true,
}));
vi.mock("@/lib/access", () => ({
  workOrderScope: () => ({}),
  staffForDepartment: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: { findFirst: mocks.workOrderFindFirst },
    auditLog: { findMany: mocks.auditLogFindMany },
    user: { findMany: mocks.userFindMany },
    template: { findMany: mocks.templateFindMany },
  },
}));
vi.mock("./actions", () => ({
  addComment: vi.fn(),
  addTechnician: vi.fn(),
  addTemplate: vi.fn(),
  setVisitStatus: vi.fn(),
  updateStatus: vi.fn(),
}));
vi.mock("@/components/MarkdownEditor", () => ({ default: () => null }));
vi.mock("@/components/WorkOrderAttachments", () => ({ default: () => null }));
vi.mock("@/components/ConfirmSubmitForm", () => ({ default: () => null }));
vi.mock("@/components/SubmitButton", () => ({ default: () => null }));
vi.mock("@/components/ReportSubmissionCleanup", () => ({ default: () => null }));
vi.mock("@/components/AuditLogTable", () => ({ default: () => null }));
vi.mock("@/components/customer/CustomerToast", () => ({ default: () => null }));

import TechnicianWorkOrderPage from "./page";

const technician = {
  id: "tech-1",
  name: "Ola Montør",
  email: "montor@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-1",
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: {
    permissions: [
      "workorders.view",
      "workorders.update",
      "workorders.edit",
      "customers.view",
      "equipment.view",
      "documents.view",
      "reports.view",
      "reports.write",
    ],
  },
};

const SERVICE_FIELDS = JSON.stringify([
  { id: "f1", type: "TEXT", label: "Tilstand" },
  { id: "f2", type: "STATUS", label: "Resultat" },
]);

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-1",
    templateId: "tpl-1",
    reportNumber: "R-1001",
    isLocked: true,
    units: [
      {
        id: "unit-1",
        label: "Port Nord",
        status: "GODKJENT",
        answersJson: JSON.stringify({ f1: "OK" }),
      },
    ],
    ...overrides,
  };
}

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-1",
    startsAt: new Date("2026-10-30T08:00:00.000Z"),
    endsAt: new Date("2026-10-30T10:00:00.000Z"),
    allDay: false,
    status: "PLANNED",
    notes: null,
    technicians: [
      {
        visitId: "visit-1",
        userId: "tech-1",
        user: { id: "tech-1", name: "Ola Montør", email: "montor@example.test" },
      },
    ],
    ...overrides,
  };
}

function makeWorkOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    title: "Service – portautomatikk",
    orderNumber: "1001",
    status: "IN_PROGRESS",
    legalHold: false,
    departmentId: "dep-1",
    department: { id: "dep-1", name: "Hovedavdeling", isActive: true },
    customerId: "cust-1",
    customer: {
      id: "cust-1",
      name: "Nordvik Testindustri AS",
      phone: "70000000",
      address: "Storgata 1",
      postalCode: "6002",
      city: "Ålesund",
      contacts: [
        {
          id: "contact-2",
          name: "Kari Kontakt",
          phone: "99999999",
          email: "kari@example.test",
        },
      ],
    },
    contact: {
      id: "contact-1",
      name: "Kari Kontakt",
      phone: "99999999",
      email: "kari@example.test",
    },
    technicians: [
      { id: "tech-1", name: "Ola Montør", role: "TECHNICIAN" },
    ],
    templates: [
      {
        id: "tpl-1",
        title: "Service av porter",
        category: "SERVICE",
        hmsType: null,
        fieldsJson: SERVICE_FIELDS,
      },
    ],
    reports: [makeReport()],
    reportDrafts: [],
    tags: [],
    visits: [],
    workComments: [],
    attachments: [],
    product: { id: "prod-1", model: "Portautomatikk" },
    productId: "prod-1",
    description: null,
    address: null,
    postalCode: null,
    city: null,
    scheduledFor: new Date("2026-10-30T00:00:00.000Z"),
    scheduledTo: null,
    ...overrides,
  };
}

async function render(
  overrides: Record<string, unknown> = {},
  searchParams: Record<string, string> = {},
) {
  mocks.workOrderFindFirst.mockResolvedValue(makeWorkOrder(overrides));
  const element = await TechnicianWorkOrderPage({
    params: Promise.resolve({ id: "wo-1" }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(technician);
  mocks.auditLogFindMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.templateFindMany.mockResolvedValue([]);
});

describe("feltdetalj – live opplysninger", () => {
  it("viser ordrenummer, dato, kunde, kontakt, adresse, montør og sjekklistetelling", async () => {
    const html = await render();

    expect(html).toContain("1001");
    expect(html).toContain("Nordvik Testindustri AS");
    expect(html).toContain("Kari Kontakt");
    expect(html).toContain("Storgata 1, 6002, Ålesund");
    expect(html).toContain("Ola Montør");
    expect(html).toContain(
      'orders.detail.checklistsCount {&quot;done&quot;:1,&quot;total&quot;:1}',
    );
  });

  it("gir hurtighandlingene ekte lenker med 44 px trykkflate", async () => {
    const html = await render();

    expect(html).toContain('href="tel:99999999"');
    expect(html).toContain(
      "https://www.google.com/maps/search/?api=1&amp;query=Storgata%201%2C%206002%2C%20%C3%85lesund",
    );
    expect(html).toContain('href="/kunder/cust-1"');
    expect(html).toContain('href="/enheter/prod-1"');
    expect(html).toContain(
      'href="/dokumenter?q=Service%20%E2%80%93%20portautomatikk"',
    );

    const quickLinks = html.match(
      /class="[^"]*min-h-11[^"]*shrink-0[^"]*"/g,
    );
    expect(quickLinks?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});

describe("feltdetalj – framdrift og CTA", () => {
  it("viser ekte progresjonsring med besvarte punkter og avvik", async () => {
    const html = await render({
      reports: [
        makeReport({
          units: [
            {
              id: "unit-1",
              label: "Port Nord",
              status: "AVVIK",
              answersJson: JSON.stringify({ f1: "OK" }),
            },
          ],
        }),
      ],
    });

    expect(html).toContain(
      'role="progressbar" aria-valuemin="0" aria-valuemax="2" aria-valuenow="1"',
    );
    expect(html).toContain("50%");
    expect(html).toContain("1/2");
    expect(html).toContain(
      'orders.fieldDetail.checklistDeviations {&quot;count&quot;:1}',
    );
  });

  it("starter skjemaet når sjekklisten verken har rapport eller kladd", async () => {
    const html = await render({ reports: [], reportDrafts: [] });

    expect(html).toContain('href="/mine-oppdrag/wo-1/skjema/tpl-1"');
    expect(html).toContain("orders.fieldDetail.stickyStartForm");
    expect(html).not.toContain("orders.fieldDetail.stickyContinueForm");
  });

  it("fortsetter skjemaet når det finnes en kladd for neste sjekkliste", async () => {
    const html = await render({
      reports: [],
      reportDrafts: [
        {
          id: "draft-1",
          templateId: "tpl-1",
          dataJson: JSON.stringify({ units: [] }),
          updatedAt: new Date("2026-10-30T10:00:00.000Z"),
        },
      ],
    });

    expect(html).toContain('href="/mine-oppdrag/wo-1/skjema/tpl-1"');
    expect(html).toContain("orders.fieldDetail.stickyContinueForm");
  });

  it("sender låste sjekklister videre til statusfullføring", async () => {
    const html = await render();

    expect(html).toContain('href="#status"');
    expect(html).toContain("orders.workOrderForm.title");
    expect(html).not.toContain("orders.fieldDetail.stickyComplete");
  });

  it("bruker den korte fullføretiketten når oppdraget ikke har sjekklister", async () => {
    const html = await render({ templates: [], reports: [] });

    expect(html).toContain('href="#status"');
    expect(html).toContain("orders.fieldDetail.stickyComplete");
    expect(html).not.toContain("orders.workOrderForm.title");
  });

  it("fortsetter en ulåst rapport selv om en annen er låst", async () => {
    const secondTemplate = {
      id: "tpl-2",
      title: "HMS – trykkbeholder",
      category: "HMS",
      hmsType: "GENERAL",
      fieldsJson: JSON.stringify([
        { id: "h1", type: "TEXT", label: "Trykk" },
      ]),
    };
    const html = await render({
      templates: [
        ...makeWorkOrder().templates,
        secondTemplate,
      ],
      reports: [
        makeReport(),
        makeReport({
          id: "report-2",
          templateId: "tpl-2",
          isLocked: false,
        }),
      ],
    });

    expect(html).toContain('href="/mine-oppdrag/wo-1/skjema/tpl-2"');
    expect(html).toContain("orders.fieldDetail.stickyContinueForm");
  });
});

describe("feltdetalj – visitt", () => {
  it("viser dagens visitt med ekte start–slutt, sted, status og montører", async () => {
    // Datoen må være relativ til «nå», ellers slutter testen å være en
    // dagens-visitt-test dagen etter at den ble skrevet.
    const today = dateOnlyInOslo(new Date());
    const dayStart = osloDayStart(today).getTime();
    const startsAt = new Date(dayStart + 9 * 60 * 60_000);
    const endsAt = new Date(dayStart + 11 * 60 * 60_000);
    const html = await render({ visits: [makeVisit({ startsAt, endsAt })] });

    expect(html).toContain("orders.fieldDetail.visits.todayTitle");
    expect(html).toContain("09:00");
    expect(html).toContain("11:00");
    expect(html).toContain("Storgata 1, 6002, Ålesund");
    expect(html).toContain("Ola Montør");
    expect(html).toContain("visits.status.planned");
    expect(html).toContain('name="status" value="EN_ROUTE"');
    expect(html).toContain('aria-live="polite"');
  });

  it("viser «Hele dagen» for heldagsvisitt", async () => {
    const html = await render({
      visits: [
        makeVisit({
          allDay: true,
          startsAt: new Date("2026-10-30T00:00:00.000Z"),
          endsAt: new Date("2026-10-31T00:00:00.000Z"),
        }),
      ],
    });

    expect(html).toContain("orders.fieldDetail.visits.allDay");
    expect(html).not.toContain("09:00");
  });

  it("viser tomtilstand når oppdraget mangler visitt", async () => {
    const html = await render({ visits: [] });

    expect(html).toContain("orders.fieldDetail.visits.empty");
    expect(html).not.toContain('name="visitId"');
    expect(html).not.toContain('value="EN_ROUTE"');
  });

  it("går fra start kjøring til på stedet", async () => {
    const html = await render({
      visits: [makeVisit({ status: "EN_ROUTE" })],
    });

    expect(html).toContain("visits.status.enRoute");
    expect(html).toContain('name="status" value="ON_SITE"');
    expect(html).not.toContain('name="status" value="EN_ROUTE"');
    expect(html).not.toContain('name="status" value="DONE"');
  });

  it("fullfører bare en visitt som er på stedet", async () => {
    const html = await render({
      visits: [makeVisit({ status: "ON_SITE" })],
    });

    expect(html).toContain('name="status" value="DONE"');
    expect(html).not.toContain('name="status" value="ON_SITE"');
    expect(html).not.toContain('name="status" value="EN_ROUTE"');
  });

  it("skjuler statusknapper på en avsluttet visitt", async () => {
    const html = await render({
      visits: [makeVisit({ status: "DONE" })],
    });

    expect(html).toContain("visits.status.done");
    expect(html).toContain("orders.fieldDetail.visits.locked");
    expect(html).not.toContain('name="status" value="DONE"');
  });

  it("viser resultatet av statusendringen i en aria-live-sone", async () => {
    const okHtml = await render({ visits: [makeVisit()] }, { visitOk: "1" });
    expect(okHtml).toContain("orders.fieldDetail.visits.statusUpdated");

    const errorHtml = await render(
      { visits: [makeVisit()] },
      { visitError: "statusTransition" },
    );
    expect(errorHtml).toContain(
      "orders.fieldDetail.visits.errors.statusTransition",
    );
  });
});
