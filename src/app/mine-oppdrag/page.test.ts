import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  addTechnician: vi.fn(),
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
vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: {
      findMany: mocks.findMany,
      count: mocks.count,
      findFirst: vi.fn(),
    },
  },
}));
vi.mock("@/server/work-orders", () => ({
  addTechnician: mocks.addTechnician,
}));
vi.mock("@/components/StatusBadge", () => ({
  default: ({ status }: { status: string }) => `[status:${status}]`,
}));
vi.mock("@/components/LogoutButton", () => ({ default: () => null }));
vi.mock("@/components/SubmitButton", () => ({ default: () => null }));
vi.mock("@/components/customer/CustomerToast", () => ({ default: () => null }));

import TechnicianDashboard from "./page";

const technician = {
  id: "tech-1",
  name: "Ola Montør",
  email: "montor@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-1",
  department: { id: "dep-1", name: "Hovedavdeling", isActive: true },
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: {
    permissions: [
      "workorders.view",
      "workorders.update",
      "workorders.create",
      "customers.view",
      "reports.view",
      "templates.view",
      "documents.view",
    ],
  },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    title: "Service på port",
    orderNumber: "1001",
    status: "PLANNED",
    address: null,
    postalCode: null,
    city: null,
    scheduledFor: new Date("2026-10-29T00:00:00.000Z"),
    scheduledTo: null,
    customer: {
      id: "cust-1",
      name: "Nordvik AS",
      phone: "70000000",
      address: "Storgata 1",
      postalCode: "6002",
      city: "Ålesund",
    },
    contact: {
      id: "contact-1",
      name: "Kari Kontakt",
      phone: "99999999",
      email: "kari@example.test",
    },
    tags: [],
    templates: [{ id: "tpl-1", title: "Service" }],
    reportDrafts: [
      {
        templateId: "tpl-1",
        updatedAt: new Date("2026-10-29T12:32:00.000Z"),
      },
    ],
    ...overrides,
  };
}

function queue(
  rows: { overdue?: unknown[]; today?: unknown[]; later?: unknown[]; available?: unknown[]; history?: unknown[] },
  counts: { overdue?: number; today?: number; later?: number; available?: number; history?: number },
) {
  for (const value of [
    rows.overdue ?? [],
    rows.today ?? [],
    rows.later ?? [],
    rows.available ?? [],
    rows.history ?? [],
  ]) {
    mocks.findMany.mockResolvedValueOnce(value);
  }
  for (const value of [
    counts.overdue ?? 0,
    counts.today ?? 0,
    counts.later ?? 0,
    counts.available ?? 0,
    counts.history ?? 0,
  ]) {
    mocks.count.mockResolvedValueOnce(value);
  }
}

async function renderHtml(params: Record<string, string> = {}) {
  const element = await TechnicianDashboard({
    searchParams: Promise.resolve(params),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(technician);
});

describe("/mine-oppdrag – feltets I dag", () => {
  it("viser kontaktperson, ringeknapp, kart og kladd på kortet", async () => {
    queue(
      { overdue: [row()] },
      { overdue: 1 },
    );

    const html = await renderHtml();

    expect(html).toContain("Kari Kontakt");
    expect(html).toContain("tel:99999999");
    expect(html).toContain("https://www.google.com/maps/search/");
    expect(html).toContain("orders.fieldList.draftBadge");
    expect(html).toContain("orders.fieldList.draftContinue");
    expect(html).toContain("/mine-oppdrag/wo-1/skjema/tpl-1");
    expect(html).toContain('href="/mine-oppdrag/wo-1"');
    expect(html).toContain("[status:PLANNED]");
    expect(html).toContain("orders.fieldList.priorityOverdue");
  });

  it("henter arbeidsoppdragets kontakt og brukerens egen kladd", async () => {
    queue({}, {});

    await renderHtml();

    for (const [args] of mocks.findMany.mock.calls) {
      expect(args.select.contact.select).toMatchObject({
        name: true,
        phone: true,
      });
      expect(args.select.reportDrafts.where).toEqual({ userId: "tech-1" });
    }
  });

  it("påstår ikke at det er tomt når det finnes ledige oppdrag", async () => {
    queue({}, { available: 1 });

    const html = await renderHtml();

    expect(html).toContain("orders.fieldList.assignedEmptyWithAvailable");
    expect(html).toContain("orders.fieldList.takeWorkOrderCta");
    expect(html).toContain('href="#ledige"');
    expect(html).not.toContain("orders.fieldList.noActive");
  });

  it("deler tildelte oppdrag i forfalt, i dag og senere uten overlapping", async () => {
    queue({}, {});

    await renderHtml();

    const wheres = mocks.findMany.mock.calls.map(([args]) => args.where);
    expect(wheres).toHaveLength(5);
    // Forfalt: startdato før i dag og sluttdato før i dag (eller ingen).
    expect(wheres[0].AND[1]).toEqual({
      scheduledFor: { lt: expect.any(Date) },
    });
    // I dag: perioden dekker dagen.
    expect(wheres[1].AND[1]).toMatchObject({
      scheduledFor: { lt: expect.any(Date) },
    });
    expect(wheres[1].AND[1].OR).toEqual(
      expect.arrayContaining([
        { scheduledTo: { gte: expect.any(Date) } },
      ]),
    );
    // Senere: starter etter i dag eller mangler dato.
    expect(wheres[2].AND[1].OR).toEqual(
      expect.arrayContaining([
        { scheduledFor: { gte: expect.any(Date) } },
        { scheduledFor: null },
      ]),
    );
    // Ledige er aldri tildelt noen montør.
    expect(wheres[3].technicians).toEqual({ none: {} });
    // Historikken er fullførte oppdrag.
    expect(wheres[4].status).toBe("COMPLETED");
  });

  it("løfter neste jobb til helten med tid, adresse og startskjema", async () => {
    queue(
      {
        today: [
          row({ reportDrafts: [] }),
          row({ id: "wo-2", title: "Andre jobb" }),
        ],
      },
      { today: 2 },
    );

    const html = await renderHtml();

    expect(html).toContain("orders.fieldList.nextJob");
    expect(html).toContain("orders.fieldList.startForm");
    expect(html).toContain("field-app");
    expect(html).toContain("field-hero");
    expect(html).toContain("field-cta");
    expect(html).toContain("field-sheet");
    expect(html).toContain("09:00");
    expect(html).toContain("Storgata 1");
    expect(html).toContain("1/2");
    expect(html).toContain("/mine-oppdrag/wo-1/skjema/tpl-1");
    expect(html).toContain("orders.fieldList.draftBadge");
    // Helten erstatter dagens første kort, så jobben skal ikke listes to ganger.
    expect(html.split("Service på port").length - 1).toBe(1);
    expect(html).toContain("Andre jobb");
  });

  it("legger resten av dagen og kommende jobber i papirarket «Senere i dag»", async () => {
    queue(
      {
        today: [
          row(),
          row({ id: "wo-2", title: "Andre jobb", reportDrafts: [] }),
        ],
        later: [
          row({
            id: "wo-3",
            title: "Senere jobb",
            reportDrafts: [],
            scheduledFor: new Date("2026-10-30T00:00:00.000Z"),
          }),
        ],
      },
      { today: 2, later: 1 },
    );

    const html = await renderHtml();

    expect(html).toContain("orders.fieldList.laterToday");
    expect(html).toContain("orders.fieldList.laterTodayHint");
    expect(html).toContain("/mine-oppdrag/wo-3");
    expect(html.split("Senere jobb").length - 1).toBeGreaterThan(0);
    expect(html.split("Service på port").length - 1).toBe(1);
  });

  it("beholder historikken og lar den ikke fylle prioritetsstakken", async () => {
    queue(
      {
        history: [
          row({ id: "wo-old", status: "COMPLETED", reportDrafts: [] }),
        ],
      },
      { history: 1 },
    );

    const html = await renderHtml();

    expect(html).toContain("orders.fieldList.historyTitle");
    expect(html).toContain("/mine-oppdrag/wo-old");
  });
});
