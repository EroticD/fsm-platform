import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireModulePage: vi.fn(async () => {}),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  getQuote: vi.fn(),
  brandingFindFirst: vi.fn(async () => ({ companyName: "Eksempel Service AS", logoUrl: null as string | null })),
}));

vi.mock("@/lib/module-guards", () => ({
  requireModulePage: mocks.requireModulePage,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const translate = (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key;
    return translate;
  }),
  getLocale: vi.fn(async () => "nb"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/quotes", () => ({ getQuote: mocks.getQuote }));
vi.mock("@/lib/prisma", () => ({
  default: {
    branding: { findFirst: mocks.brandingFindFirst },
  },
}));

import QuotePrintPage from "./page";

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
    if (typeof props?.label === "string") result.text.push(props.label);
    collect(props?.children, result);
  }
  return result;
}

function makeQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    quoteNumber: "T-261108-ABC123",
    title: "Service og reparasjon",
    status: "SENT",
    version: 2,
    currency: "NOK",
    subtotal: 250,
    vatTotal: 62.5,
    total: 312.5,
    vatRate: 25,
    validUntil: new Date("2027-12-31T00:00:00.000Z"),
    notes: "Monteres etter avtale.",
    createdAt: new Date("2026-11-08T10:00:00.000Z"),
    customer: {
      id: "c1",
      name: "Kunde AS",
      orgNumber: "912345678",
      address: "Gate 1",
      postalCode: "0150",
      city: "Oslo",
    },
    contact: { id: "ct1", name: "Kari Kunde", email: "kari@example.test", phone: "90000000" },
    department: { id: "d1", name: "Oslo" },
    lines: [
      {
        id: "l1",
        description: "Arbeid",
        quantity: 2,
        unit: "stk",
        unitPrice: 100,
        vatRate: 25,
        lineTotal: 200,
      },
      {
        id: "l2",
        description: "Materiell",
        quantity: 1,
        unit: "stk",
        unitPrice: 50,
        vatRate: 25,
        lineTotal: 50,
      },
    ],
    ...overrides,
  };
}

async function render(options: { quote?: Record<string, unknown>; ok?: boolean } = {}) {
  const { quote = makeQuote(), ok = true } = options;
  mocks.getQuote.mockResolvedValue(
    ok ? { ok: true, data: quote } : { ok: false, reason: "not_found" },
  );
  const element = await QuotePrintPage({ params: Promise.resolve({ id: "q1" }) });
  return collect(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModulePage.mockResolvedValue(undefined);
  mocks.brandingFindFirst.mockResolvedValue({ companyName: "Eksempel Service AS", logoUrl: null });
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    name: "Tekniker",
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "d1",
    customerId: null,
    permissions: ["customers.view"],
    permissionsCustomized: true,
  });
});

describe("tilbudets utskriftsvisning", () => {
  it("viser dokumenttittel, kunde, linjer, MVA og totaler", async () => {
    const { text, hrefs, srcs } = await render();

    const body = text.join(" | ");
    expect(body).toContain("quotes.print.document");
    expect(body).toContain("Service og reparasjon");
    expect(body).toContain("T-261108-ABC123");
    expect(body).toContain("Kunde AS");
    expect(body).toContain("Arbeid");
    expect(body).toContain("Materiell");
    expect(body).toContain("250,00");
    expect(body).toContain("62,50");
    expect(body).toContain("312,50");
    expect(body).toContain("quotes.status.SENT");
    expect(body).toContain("Monteres etter avtale.");
    expect(body).toContain("quotes.print.print");
    expect(hrefs).toContain("/tilbud/q1");
    expect(srcs).toEqual([]);

    expect(mocks.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", role: "TECHNICIAN" }),
      "q1",
    );
  });

  it("viser bedriftslogo når merkevaren har en", async () => {
    mocks.brandingFindFirst.mockResolvedValue({
      companyName: "Eksempel Service AS",
      logoUrl: "/uploads/logo.png",
    });

    const { text, srcs } = await render();

    expect(srcs).toContain("/uploads/logo.png");
    expect(text.join(" | ")).toContain("Eksempel Service AS");
  });

  it("gir 404 for en tekniker uten lesetilgang til tilbudet", async () => {
    await expect(render({ ok: false })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("gir 404 når quotes-modulen er av og leser ikke tilbudet", async () => {
    mocks.requireModulePage.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireModulePage).toHaveBeenCalledWith("quotes");
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });

  it("sender uinnloggede brukere til innlogging", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("REDIRECT:/api/auth/signin");
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });
});
