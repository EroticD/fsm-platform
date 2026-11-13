import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { dateOnlyInOslo, osloDayStart } from "@/lib/dates";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  workOrderFindFirst: vi.fn(),
  reportFindFirst: vi.fn(),
  auditLogFindMany: vi.fn(async () => []),
  userFindMany: vi.fn(async () => []),
  templateFindMany: vi.fn(async () => []),
  /** Propene ryddekomponenten faktisk fikk, så testen ser hvilket oppdrag ryddes. */
  cleanupProps: [] as Record<string, unknown>[],
  /** Svaret på oppslaget etter det forrige oppdraget (`sent`). */
  sentWorkOrder: null as { id: string } | null,
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
    report: { findFirst: mocks.reportFindFirst },
    auditLog: { findMany: mocks.auditLogFindMany },
    user: { findMany: mocks.userFindMany },
    template: { findMany: mocks.templateFindMany },
  },
}));
vi.mock("./actions", () => ({
  addComment: vi.fn(),
  addTechnician: vi.fn(),
  addTemplate: vi.fn(),
  finishVisitTravelFrom: vi.fn(),
  setVisitStatus: vi.fn(),
  updateStatus: vi.fn(),
}));
vi.mock("@/components/MarkdownEditor", () => ({ default: () => null }));
vi.mock("@/components/WorkOrderAttachments", () => ({ default: () => null }));
vi.mock("@/components/ConfirmSubmitForm", () => ({ default: () => null }));
vi.mock("@/components/SubmitButton", () => ({ default: () => null }));
vi.mock("@/components/ReportSubmissionCleanup", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.cleanupProps.push(props);
    return null;
  },
}));
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
    startsAt: new Date("2026-10-30T00:00:00.000Z"),
    status: "PLANNED",
    notes: null,
    enRouteAt: null,
    onSiteAt: null,
    doneAt: null,
    travelFromEndedAt: null,
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
    reference: "O-261030-REF12345",
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

/** Id-en til oppdraget rapporten ble sendt fra, i testene for neste oppdrag. */
const SENT_WORK_ORDER_ID = "wo-0";

async function render(
  overrides: Record<string, unknown> = {},
  searchParams: Record<string, string> = {},
) {
  const mainWorkOrder = makeWorkOrder(overrides);
  // Oppslaget etter det forrige oppdraget (`sent`) gjelder en annen id, og får
  // sitt eget svar – ellers ville siden sett samme oppdrag to ganger.
  mocks.workOrderFindFirst.mockImplementation(
    async (args: { where?: { id?: string } }) =>
      args?.where?.id === SENT_WORK_ORDER_ID ? mocks.sentWorkOrder : mainWorkOrder,
  );
  const element = await TechnicianWorkOrderPage({
    params: Promise.resolve({ id: "wo-1" }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cleanupProps.length = 0;
  mocks.sentWorkOrder = null;
  mocks.reportFindFirst.mockResolvedValue(null);
  mocks.getCurrentUser.mockResolvedValue(technician);
  mocks.auditLogFindMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.templateFindMany.mockResolvedValue([]);
});

describe("feltdetalj – live opplysninger", () => {
  it("viser referanse, ordrenummer, dato, kunde, kontakt, adresse, montør og sjekklistetelling", async () => {
    const html = await render();

    expect(html).toContain("O-261030-REF12345");
    expect(html).toContain("orders.detail.reference");
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
      "https://www.google.com/maps/dir/?api=1&amp;destination=Storgata%201%2C%206002%2C%20%C3%85lesund",
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

describe("feltdetalj – dagens arbeidsøkt", () => {
  it("viser dagens økt med dato, status, sted, montører og «På vei»", async () => {
    // Datoen må være relativ til «nå», ellers slutter testen å være en
    // dagens-økt-test dagen etter at den ble skrevet.
    const today = dateOnlyInOslo(new Date());
    const startsAt = osloDayStart(today);
    const html = await render({ visits: [makeVisit({ startsAt })] });

    expect(html).toContain("orders.fieldDetail.visits.todayTitle");
    expect(html).toContain("visits.status.planned");
    expect(html).toContain("Storgata 1, 6002, Ålesund");
    expect(html).toContain("Ola Montør");
    expect(html).toContain('name="status" value="EN_ROUTE"');
    expect(html).toContain('aria-live="polite"');
  });

  it("viser tomtilstand når oppdraget mangler arbeidsdager", async () => {
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

  it("fullfører bare en økt som er på stedet", async () => {
    const html = await render({
      visits: [makeVisit({ status: "ON_SITE" })],
    });

    expect(html).toContain('name="status" value="DONE"');
    expect(html).not.toContain('name="status" value="ON_SITE"');
    expect(html).not.toContain('name="status" value="EN_ROUTE"');
  });

  it("viser «Avslutt kjøring» etter fullført dag til kjøringen er avsluttet", async () => {
    const html = await render({
      visits: [
        makeVisit({
          status: "DONE",
          doneAt: new Date("2026-10-30T10:00:00.000Z"),
          travelFromEndedAt: null,
        }),
      ],
    });

    expect(html).toContain("orders.fieldDetail.visits.finishTravelFrom");
    expect(html).toContain("visits.status.done");
    expect(html).not.toContain('name="status" value="DONE"');
  });

  it("viser låst dag når kjøringen også er avsluttet", async () => {
    const html = await render({
      visits: [
        makeVisit({
          status: "DONE",
          doneAt: new Date("2026-10-30T10:00:00.000Z"),
          travelFromEndedAt: new Date("2026-10-30T10:30:00.000Z"),
        }),
      ],
    });

    expect(html).toContain("orders.fieldDetail.visits.locked");
    expect(html).not.toContain("orders.fieldDetail.visits.finishTravelFrom");
  });

  it("holder neste dag åpen etter at én dag er fullført", async () => {
    const tomorrow = dateOnlyInOslo(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    const html = await render({
      visits: [
        makeVisit({
          id: "day-1",
          status: "DONE",
          doneAt: new Date("2026-10-30T10:00:00.000Z"),
          travelFromEndedAt: null,
        }),
        makeVisit({
          id: "day-2",
          startsAt: osloDayStart(tomorrow),
          status: "PLANNED",
        }),
      ],
    });

    expect(html).toContain('name="visitId" value="day-2"');
    expect(html).toContain('name="status" value="EN_ROUTE"');
    expect(html).toContain("orders.fieldDetail.visits.time.days");
    expect(html).toContain("orders.fieldDetail.visits.finishTravelFrom");
    expect(html).not.toContain("orders.fieldDetail.visits.locked");
  });

  it("viser reisetid, arbeidstid og total tid for dagen og oppdraget", async () => {
    const today = dateOnlyInOslo(new Date());
    const dayStart = osloDayStart(today).getTime();
    const html = await render({
      visits: [
        makeVisit({
          startsAt: new Date(dayStart),
          status: "DONE",
          enRouteAt: new Date(dayStart + 8 * 60 * 60_000),
          onSiteAt: new Date(dayStart + 8.5 * 60 * 60_000),
          doneAt: new Date(dayStart + 10 * 60 * 60_000),
          travelFromEndedAt: new Date(dayStart + 10.5 * 60 * 60_000),
        }),
      ],
    });

    expect(html).toContain("orders.fieldDetail.visits.time.dayTitle");
    expect(html).toContain("orders.fieldDetail.visits.time.travelTo");
    expect(html).toContain("orders.fieldDetail.visits.time.work");
    expect(html).toContain("orders.fieldDetail.visits.time.travelFrom");
    expect(html).toContain("orders.fieldDetail.visits.time.orderTotal");
    expect(html).toContain("orders.fieldDetail.visits.time.enRouteAt");
    expect(html).toContain("orders.fieldDetail.visits.time.travelFromEndedAt");
    expect(html).toContain("30 min");
    expect(html).toContain("1 t 30 min");
    expect(html).toContain("2 t 30 min");
    expect(html).toContain("08:30");
    expect(html).toContain("10:30");
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

describe("feltdetalj – rydding etter «Lagre og neste oppdrag»", () => {
  const sentParams = {
    status: "rapport-sendt",
    sent: SENT_WORK_ORDER_ID,
    sentTemplate: "tpl-1",
  };

  it("rydder kladden for det innsendte oppdraget når rapporten er låst", async () => {
    mocks.sentWorkOrder = { id: SENT_WORK_ORDER_ID };
    mocks.reportFindFirst.mockResolvedValue({ templateId: "tpl-1" });

    await render({}, sentParams);

    expect(mocks.cleanupProps).toEqual([
      expect.objectContaining({
        userId: "tech-1",
        workOrderId: SENT_WORK_ORDER_ID,
        templateId: "tpl-1",
        verified: true,
        showReceipt: false,
      }),
    ]);
    // Låsingen kontrolleres på serveren – ikke bare ut fra query-parameteren.
    expect(mocks.reportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workOrderId: SENT_WORK_ORDER_ID,
          templateId: "tpl-1",
          isLocked: true,
          deletedAt: null,
        }),
      }),
    );
  });

  it("rydder ikke når rapporten fortsatt er ulåst", async () => {
    mocks.sentWorkOrder = { id: SENT_WORK_ORDER_ID };
    // Ulåst rapport faller utenfor `isLocked: true`, så oppslaget gir null.
    mocks.reportFindFirst.mockResolvedValue(null);

    await render({}, sentParams);

    expect(mocks.cleanupProps).toEqual([]);
  });

  it("rydder ikke når det forrige oppdraget er ukjent for brukeren", async () => {
    mocks.sentWorkOrder = null;
    mocks.reportFindFirst.mockResolvedValue({ templateId: "tpl-1" });

    await render({}, sentParams);

    expect(mocks.cleanupProps).toEqual([]);
    expect(mocks.reportFindFirst).not.toHaveBeenCalled();
  });
});
