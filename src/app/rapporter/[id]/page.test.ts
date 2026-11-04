import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  workOrderFindFirst: vi.fn(),
  reportCount: vi.fn(),
  reportFindFirst: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const translate = (
      key: string,
      values?: Record<string, unknown>,
    ) => (values ? `${key} ${JSON.stringify(values)}` : key);
    return translate;
  }),
  getLocale: vi.fn(async () => "nb"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));
vi.mock("@/lib/report-scope", () => ({
  canAccessReportWorkOrder: () => true,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: { findFirst: mocks.workOrderFindFirst },
    report: {
      count: mocks.reportCount,
      findFirst: mocks.reportFindFirst,
    },
  },
}));

import ReportViewerPage from "./page";

type Collected = { text: string[]; hrefs: string[]; srcs: string[] };

function collect(
  node: unknown,
  result: Collected = { text: [], hrefs: [], srcs: [] },
): Collected {
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
    if (typeof props?.src === "string") result.srcs.push(props.src);
    collect(props?.children, result);
  }
  return result;
}

function makeWorkOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo1",
    title: "Oppdrag",
    orderNumber: "1001",
    customerId: "c1",
    departmentId: "dep1",
    department: { isActive: true },
    status: "COMPLETED",
    customer: { id: "c1", name: "Kunde AS" },
    ...overrides,
  };
}

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    name: "Servicerapport",
    templateTitle: "Servicemal",
    reportNumber: "1001",
    isLocked: true,
    lockedAt: new Date("2026-10-20T10:00:00.000Z"),
    lockedByName: "Ola Montør",
    customerAcknowledgedAt: null,
    customerAcknowledgedBy: null,
    requiresUnits: true,
    revision: 2,
    units: [{ label: "Pumpe 1", status: "GODKJENT" }],
    ...overrides,
  };
}

async function render(
  options: {
    workOrder?: Record<string, unknown> | null;
    reportCount?: number;
    report?: Record<string, unknown> | null;
    searchParams?: Record<string, string>;
  } = {},
) {
  const {
    workOrder = makeWorkOrder(),
    reportCount = 1,
    report = makeReport(),
    searchParams = { rapport: "r1" },
  } = options;
  mocks.workOrderFindFirst.mockResolvedValue(workOrder);
  mocks.reportCount.mockResolvedValue(reportCount);
  mocks.reportFindFirst.mockResolvedValue(report);

  const element = await ReportViewerPage({
    params: Promise.resolve({ id: "wo1" }),
    searchParams: Promise.resolve(searchParams),
  });
  return collect(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    name: "Kari Kontor",
    role: "ADMIN",
    isActive: true,
    departmentId: "dep1",
    customerId: null,
    permissions: [],
    permissionsCustomized: false,
  });
});

describe("rapportviseren", () => {
  it("ber om inline-PDF og tilbyr åpne, laste ned og gå tilbake", async () => {
    const { text, hrefs, srcs } = await render();

    expect(text.join(" | ")).toContain("orders.reportViewer.reportName");
    expect(srcs).toContain("/api/rapporter/wo1/pdf?rapport=r1&inline=1");
    expect(hrefs).toContain("/api/rapporter/wo1/pdf?rapport=r1&inline=1");
    expect(hrefs).toContain(
      "/api/rapporter/wo1/pdf?rapport=r1&download=1",
    );
    expect(text.join(" | ")).toContain("orders.pdfViewer.openInNewTab");
    expect(text.join(" | ")).toContain("orders.reportViewer.download");
  });

  it("viser en tydelig feil når rapporten ikke finnes på oppdraget", async () => {
    const { text, srcs } = await render({
      report: null,
      searchParams: { rapport: "fremmed" },
    });

    expect(text.join(" | ")).toContain("orders.reportViewer.reportNotFound");
    expect(srcs).toEqual([]);
  });

  it("viser tomtilstand når oppdraget ikke har rapporter", async () => {
    const { text } = await render({
      reportCount: 0,
      searchParams: {},
    });

    expect(text.join(" | ")).toContain("orders.reportViewer.noReport");
  });

  it("viser feilmelding når oppdraget mangler", async () => {
    const { text } = await render({ workOrder: null });

    expect(text.join(" | ")).toContain(
      "orders.reportViewer.notFoundWorkOrder",
    );
  });
});
