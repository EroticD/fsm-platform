import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  getReportRevisionForPdf: vi.fn(),
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
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/report-revisions", () => ({
  getReportRevisionForPdf: mocks.getReportRevisionForPdf,
}));

import ReportRevisionPdfViewerPage from "./page";

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

function makeRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev1",
    revision: 2,
    name: "Servicerapport",
    templateTitle: "Servicemal",
    reportNumber: "1001",
    reason: "Rettet avvik",
    createdAt: new Date("2026-10-20T10:00:00.000Z"),
    actorName: "Kari Kontor",
    report: { id: "r1", reportNumber: "1001" },
    workOrder: { id: "wo1", title: "Oppdrag" },
    ...overrides,
  };
}

async function render(
  options: {
    result?: Record<string, unknown>;
    searchParams?: Record<string, string>;
  } = {},
) {
  const {
    result = { ok: true, data: makeRevision() },
    searchParams = {},
  } = options;
  mocks.getReportRevisionForPdf.mockResolvedValue(result);

  const element = await ReportRevisionPdfViewerPage({
    params: Promise.resolve({ id: "wo1", revisjonId: "rev1" }),
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

describe("revisjonsviseren", () => {
  it("ber om inline revisjons-PDF og tilbyr åpne, laste ned og gå tilbake", async () => {
    const { text, hrefs, srcs } = await render();

    expect(text.join(" | ")).toContain("orders.revisions.viewerTitle");
    expect(srcs).toContain("/api/rapporter/revisjoner/rev1/pdf?inline=1");
    expect(hrefs).toContain("/api/rapporter/revisjoner/rev1/pdf?inline=1");
    expect(hrefs).toContain(
      "/api/rapporter/revisjoner/rev1/pdf?download=1",
    );
    expect(text.join(" | ")).toContain("orders.pdfViewer.openInNewTab");
    expect(text.join(" | ")).toContain("orders.revisions.downloadPdf");
    expect(text.join(" | ")).toContain("orders.revisions.backToRevisions");
  });

  it("respekterer et internt tilbake-mål", async () => {
    const { text, hrefs } = await render({
      searchParams: { returnTo: "/rapporter?vis=alle" },
    });

    expect(hrefs).toContain("/rapporter?vis=alle");
    expect(text.join(" | ")).toContain("orders.revisions.back");
  });

  it("viser tilgangsfeil uten å legge ut PDF-lenke", async () => {
    const { text, srcs } = await render({
      result: { ok: false, error: "forbidden" },
    });

    expect(text.join(" | ")).toContain("orders.pdfViewer.errors.forbidden");
    expect(srcs).toEqual([]);
  });

  it("viser ikke funnet når revisjonen mangler", async () => {
    const { text, srcs } = await render({
      result: { ok: false, error: "not_found" },
    });

    expect(text.join(" | ")).toContain("orders.pdfViewer.errors.notFound");
    expect(srcs).toEqual([]);
  });

  it("avviser revisjon som hører til et annet oppdrag", async () => {
    mocks.getReportRevisionForPdf.mockResolvedValue({
      ok: true,
      data: makeRevision(),
    });
    const element = await ReportRevisionPdfViewerPage({
      params: Promise.resolve({ id: "annet-oppdrag", revisjonId: "rev1" }),
      searchParams: Promise.resolve({}),
    });
    const result = collect(element);

    expect(result.text.join(" | ")).toContain(
      "orders.pdfViewer.errors.notFound",
    );
    expect(result.srcs).toEqual([]);
  });
});
