import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  getTranslations: vi.fn(),
  getLocale: vi.fn(async () => "nb"),
  workOrderFindFirst: vi.fn(),
  auditLogFindMany: vi.fn(async () => []),
  templateFindMany: vi.fn(async () => []),
  tagFindMany: vi.fn(async () => []),
  userFindMany: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
  getLocale: mocks.getLocale,
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
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
    template: { findMany: mocks.templateFindMany },
    tag: { findMany: mocks.tagFindMany },
    user: { findMany: mocks.userFindMany },
  },
}));
vi.mock("./actions", () => ({
  addContactToCustomer: vi.fn(),
  assignTechnician: vi.fn(),
  cloneWorkOrder: vi.fn(),
  deleteWorkOrder: vi.fn(),
  setContact: vi.fn(),
  setReportLegalHold: vi.fn(),
  setReportLock: vi.fn(),
  setTags: vi.fn(),
  setTemplate: vi.fn(),
  setWorkOrderLegalHold: vi.fn(),
  unassignTechnician: vi.fn(),
  updateStatus: vi.fn(),
}));

import AdminWorkOrderPage from "./page";

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    dataJson: "{}",
    comments: null,
    completedAt: new Date("2026-10-20T10:00:00.000Z"),
    technicianSignatureUrl: null,
    technicianName: "Ola Montør",
    customerSignatureUrl: null,
    customerName: null,
    workOrderId: "wo1",
    templateId: null,
    templateTitle: "Signert sjekkliste",
    name: "Signert HMS-rapport",
    reportNumber: "abc1234",
    requiresUnits: true,
    templateCategory: "SERVICE",
    hmsType: null,
    templateSnapshotJson: null,
    createdAt: new Date("2026-10-20T10:00:00.000Z"),
    updatedAt: new Date("2026-10-20T10:00:00.000Z"),
    isLocked: true,
    lockedAt: new Date("2026-10-20T10:00:00.000Z"),
    lockedByName: "Ola Montør",
    pdfUrl: null,
    pdfHash: null,
    pdfGeneratedAt: null,
    customerAcknowledgedAt: null,
    customerAcknowledgedBy: null,
    customerAcknowledgedComment: null,
    revision: 2,
    deletedAt: null,
    deletedBy: null,
    legalHold: false,
    units: [
      {
        id: "unit1",
        label: "Pumpe 1",
        serialNumber: "SN-1",
        location: "Kjeller",
        status: "GODKJENT",
        answersJson: "{}",
        comment: null,
      },
    ],
    ...overrides,
  };
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Servicemal",
    category: "SERVICE",
    hmsType: null,
    fieldsJson: "[]",
    ...overrides,
  };
}

function makeWorkOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo1",
    title: "Fullført oppdrag",
    status: "COMPLETED",
    legalHold: false,
    departmentId: "dep1",
    department: { id: "dep1", name: "Avdeling", isActive: true },
    customerId: "c1",
    customer: { id: "c1", name: "Kunde AS", contacts: [] },
    contact: null,
    contactId: null,
    technicians: [],
    templates: [],
    tags: [],
    reports: [],
    workComments: [],
    attachments: [],
    product: null,
    creatorName: "Kari Kontor",
    description: null,
    address: null,
    postalCode: null,
    city: null,
    orderNumber: "1001",
    deletedAt: null,
    ...overrides,
  };
}

type Collected = { text: string[]; hrefs: string[] };

/** Henter tekst og lenker fra elementtreet uten å rendre klientkomponenter. */
function collect(node: unknown, result: Collected = { text: [], hrefs: [] }): Collected {
  if (node == null || typeof node === "boolean") return result;
  if (typeof node === "string" || typeof node === "number") {
    result.text.push(String(node));
    return result;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, result);
    return result;
  }
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (typeof props?.href === "string") result.hrefs.push(props.href);
    collect(props?.children, result);
  }
  return result;
}

async function render(overrides: Record<string, unknown> = {}) {
  mocks.workOrderFindFirst.mockResolvedValue(makeWorkOrder(overrides));
  const element = await AdminWorkOrderPage({
    params: Promise.resolve({ id: "wo1" }),
    searchParams: Promise.resolve({}),
  });
  return collect(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId: "dep1",
    customerId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: [] },
  });
  mocks.getTranslations.mockResolvedValue(
    (key: string, values?: Record<string, unknown>) =>
      values && Object.keys(values).length > 0
        ? `${key} ${JSON.stringify(values)}`
        : key,
  );
  mocks.workOrderFindFirst.mockResolvedValue(makeWorkOrder());
});

describe("oppdragsdetaljer – rapporter uten mal", () => {
  it("henter bare ikke-slettede rapporter", async () => {
    await render();

    expect(mocks.workOrderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          reports: expect.objectContaining({
            where: { deletedAt: null },
          }),
        }),
      }),
    );
  });

  it("viser signert rapport selv når oppdraget har null maler", async () => {
    const { text, hrefs } = await render({
      templates: [],
      reports: [makeReport()],
    });

    expect(text).not.toContain("orders.detail.noChecklists");
    expect(text).toContain("orders.detail.orphanReport");
    expect(text).toContain("orders.detail.locked");
    expect(text.join(" | ")).toContain("Signert HMS-rapport");
    expect(text.join(" | ")).toContain("abc1234");
    expect(text.join(" | ")).toContain("orders.reportsPage.units");
    expect(hrefs).toContain("/rapporter/wo1?rapport=r1");
    expect(hrefs).toContain("/rapporter/wo1/revisjoner?rapport=r1");
  });

  it("behandler rapport med ukjent mal-id som rapport uten mal", async () => {
    const { text, hrefs } = await render({
      templates: [makeTemplate()],
      reports: [
        makeReport({
          id: "r-old",
          templateId: "t-fjernet",
          name: "Eldre signert rapport",
        }),
      ],
    });

    expect(text).toContain("orders.detail.orphanReport");
    expect(text.join(" | ")).toContain("Eldre signert rapport");
    expect(hrefs).toContain("/rapporter/wo1?rapport=r-old");
  });

  it("viser samme rapport bare én gang når den har en mal", async () => {
    const { hrefs } = await render({
      templates: [makeTemplate()],
      reports: [
        makeReport({ id: "r-matched", templateId: "t1", name: "Med mal" }),
        makeReport({ id: "r-orphan", templateId: null, name: "Uten mal" }),
      ],
    });

    expect(
      hrefs.filter((href) => href === "/rapporter/wo1?rapport=r-matched"),
    ).toHaveLength(1);
    expect(
      hrefs.filter((href) => href === "/rapporter/wo1?rapport=r-orphan"),
    ).toHaveLength(1);
  });

  it("beholder tomteksten bare når det verken finnes maler eller rapporter", async () => {
    const { text } = await render({ templates: [], reports: [] });

    expect(text).toContain("orders.detail.noChecklists");
    expect(text).not.toContain("orders.detail.orphanReport");
  });
});
