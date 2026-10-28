import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "@/lib/access";

const mocks = vi.hoisted(() => ({
  customerFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  contactFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  productFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  workOrderFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  tagFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  reportFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  commentFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  userFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  templateFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  folderFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  documentFindMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  customerCount: vi.fn(async () => 0),
  contactCount: vi.fn(async () => 0),
  productCount: vi.fn(async () => 0),
  workOrderCount: vi.fn(async () => 0),
  tagCount: vi.fn(async () => 0),
  reportCount: vi.fn(async () => 0),
  commentCount: vi.fn(async () => 0),
  userCount: vi.fn(async () => 0),
  templateCount: vi.fn(async () => 0),
  folderCount: vi.fn(async () => 0),
  documentCount: vi.fn(async () => 0),
  searchByName: vi.fn<
    (table: string, column: string, query: string, limit: number) => Promise<{ id: string; score: number }[]>
  >(async () => []),
  searchBySubstring: vi.fn<
    (table: string, column: string, query: string, limit: number) => Promise<{ id: string; score: number }[]>
  >(async () => []),
  searchNormalizedIds: vi.fn<
    (table: string, query: string, limit: number, columns?: string[]) => Promise<{ id: string; score: number }[]>
  >(async () => []),
  searchWorkOrderIdsWithTotal: vi.fn(async () => ({ ids: [] as string[], total: 0 })),
  searchDocuments: vi.fn<(query: string, limit: number) => Promise<unknown[]>>(async () => []),
  searchReports: vi.fn<(query: string, options: unknown) => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    customer: { findMany: mocks.customerFindMany, count: mocks.customerCount },
    contact: { findMany: mocks.contactFindMany, count: mocks.contactCount },
    product: { findMany: mocks.productFindMany, count: mocks.productCount },
    workOrder: { findMany: mocks.workOrderFindMany, count: mocks.workOrderCount },
    tag: { findMany: mocks.tagFindMany, count: mocks.tagCount },
    report: { findMany: mocks.reportFindMany, count: mocks.reportCount },
    comment: { findMany: mocks.commentFindMany, count: mocks.commentCount },
    user: { findMany: mocks.userFindMany, count: mocks.userCount },
    template: { findMany: mocks.templateFindMany, count: mocks.templateCount },
    documentFolder: { findMany: mocks.folderFindMany, count: mocks.folderCount },
    document: { findMany: mocks.documentFindMany, count: mocks.documentCount },
  },
}));

vi.mock("@/lib/search-sql", () => ({
  searchByName: mocks.searchByName,
  searchBySubstring: mocks.searchBySubstring,
  searchNormalizedIds: mocks.searchNormalizedIds,
  searchWorkOrderIdsWithTotal: mocks.searchWorkOrderIdsWithTotal,
  searchDocuments: mocks.searchDocuments,
  searchReports: mocks.searchReports,
}));

import { performSearch } from "@/lib/search";

const admin = {
  id: "user-1",
  role: "ADMIN",
  isActive: true,
  departmentId: "dept-1",
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
} as unknown as AccessUser;

function workOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    title: "Service",
    orderNumber: "NO-2026-1042",
    description: null,
    creatorName: null,
    status: "PLANNED",
    scheduledFor: null,
    customer: { name: "Kunde AS" },
    tags: [],
    technicians: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [
    mocks.customerFindMany,
    mocks.contactFindMany,
    mocks.productFindMany,
    mocks.workOrderFindMany,
    mocks.tagFindMany,
    mocks.reportFindMany,
    mocks.commentFindMany,
    mocks.userFindMany,
    mocks.templateFindMany,
    mocks.folderFindMany,
    mocks.documentFindMany,
  ]) {
    mock.mockResolvedValue([]);
  }
  for (const mock of [
    mocks.customerCount,
    mocks.contactCount,
    mocks.productCount,
    mocks.workOrderCount,
    mocks.tagCount,
    mocks.reportCount,
    mocks.commentCount,
    mocks.userCount,
    mocks.templateCount,
    mocks.folderCount,
    mocks.documentCount,
  ]) {
    mock.mockResolvedValue(0);
  }
  mocks.searchByName.mockResolvedValue([]);
  mocks.searchBySubstring.mockResolvedValue([]);
  mocks.searchNormalizedIds.mockResolvedValue([]);
  mocks.searchWorkOrderIdsWithTotal.mockResolvedValue({ ids: [], total: 0 });
  mocks.searchDocuments.mockResolvedValue([]);
  mocks.searchReports.mockResolvedValue([]);
});

describe("performSearch – ordrenummer, tagger og delte rapporter", () => {
  it("viser tag-gruppe med lenke til filtrert oppdragsliste", async () => {
    mocks.searchBySubstring.mockImplementation(async (table: string, column: string) => {
      if (table === "Tag" && column === "name") {
        return [{ id: "tag-1", score: 1 }];
      }
      return [];
    });
    mocks.tagFindMany.mockResolvedValue([
      { id: "tag-1", name: "Årlig service", color: "#3b82f6" },
    ]);
    mocks.tagCount.mockResolvedValue(1);
    mocks.workOrderFindMany.mockResolvedValue([
      workOrderRow({ tags: [{ id: "tag-1", name: "Årlig service", color: "#3b82f6" }] }),
    ]);
    mocks.workOrderCount.mockResolvedValue(1);

    const results = await performSearch("arlig-service", { user: admin });

    const tagGroup = results.groups.find((group) => group.kind === "tag");
    expect(tagGroup?.items[0]).toMatchObject({
      title: "Årlig service",
      href: "/oppdrag?tag=%C3%85rlig%20service",
    });
    expect(tagGroup?.total).toBe(1);

    const workOrderGroup = results.groups.find((group) => group.kind === "workOrder");
    expect(workOrderGroup?.items[0].title).toContain("NO-2026-1042");
    expect(workOrderGroup?.items[0].subtitle).toContain("Årlig service");

    // Tag-treffet gir også oppdraget, selv uten treff i tittel/ordrenummer.
    const workOrderWhere = mocks.workOrderFindMany.mock.calls[0][0] as {
      where: { AND: unknown[] };
    };
    expect(JSON.stringify(workOrderWhere.where)).toContain('"tags"');

    // Tag-genren skal bare vise tagger som brukes av et oppdrag søkeren ser.
    const tagArgs = mocks.tagFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(tagArgs.where).toMatchObject({
      AND: expect.arrayContaining([
        { id: { in: ["tag-1"] } },
        {
          workOrders: {
            some: {
              AND: expect.arrayContaining([{ deletedAt: null }]),
            },
          },
        },
      ]),
    });
  });

  it("avgrenser tag-resultater til brukerens avdeling", async () => {
    const technician = {
      id: "tech-1",
      role: "TECHNICIAN",
      isActive: true,
      departmentId: "dept-2",
      customerId: null,
      permissions: [],
      permissionsCustomized: false,
      roleDefinition: { permissions: ["workorders.view", "customers.view"] },
    } as unknown as AccessUser;

    mocks.searchBySubstring.mockImplementation(async (table: string) => {
      if (table === "Tag") return [{ id: "tag-hemmelig", score: 1 }];
      return [];
    });
    mocks.tagFindMany.mockResolvedValue([]);

    await performSearch("hemmelig", { user: technician });

    const tagArgs = mocks.tagFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(JSON.stringify(tagArgs.where)).toContain('"departmentId":"dept-2"');
  });

  it("søker i ordrenummer med normalisert delstreng", async () => {
    mocks.searchBySubstring.mockImplementation(async (table: string, column: string) => {
      if (table === "WorkOrder" && column === "orderNumber") {
        return [{ id: "wo-2", score: 1 }];
      }
      return [];
    });
    mocks.workOrderFindMany.mockResolvedValue([
      workOrderRow({ id: "wo-2", title: "Kontroll", customer: null }),
    ]);
    mocks.workOrderCount.mockResolvedValue(1);

    const results = await performSearch("2026-1042", { user: admin });

    expect(mocks.searchBySubstring).toHaveBeenCalledWith(
      "WorkOrder",
      "orderNumber",
      "2026 1042",
      expect.any(Number),
    );
    const workOrderGroup = results.groups.find((group) => group.kind === "workOrder");
    expect(workOrderGroup?.items[0].title).toContain("NO-2026-1042");
  });

  it("utelater kommentarer som henger på en slettet kunde", async () => {
    mocks.searchNormalizedIds.mockImplementation(async (table: string) => {
      if (table === "Comment") return [{ id: "comment-1", score: 1 }];
      return [];
    });

    await performSearch("service", { user: admin });

    const args = mocks.commentFindMany.mock.calls[0][0] as {
      where: { AND: unknown[] };
    };
    const json = JSON.stringify(args.where);

    expect(json).toContain('"customer":{"deletedAt":null}');
    expect(json).toContain('"contact":{"customer":{"deletedAt":null}}');
  });

  it("henter rapporter uten avdelingsfilter og bruker fulltekstsøket", async () => {
    mocks.searchReports.mockResolvedValue([
      { id: "report-1", score: 0.9, snippet: "Pumpe byttet", total: 7 },
    ]);

    const results = await performSearch("pumpe", { user: admin, includeCancelled: true });
    const reportArgs = mocks.searchReports.mock.calls[0][1] as {
      includeCancelled: boolean;
      filters: unknown;
    };

    expect(reportArgs.includeCancelled).toBe(true);
    expect(reportArgs.filters).toBeDefined();
    expect(mocks.reportFindMany).toHaveBeenCalled();
    const reportGroup = results.groups.find((group) => group.kind === "report");
    // Totalen kommer fra SQL-tellingen, ikke fra de få radene som vises.
    expect(reportGroup?.total).toBe(7);
  });
});

describe("performSearch – filtre, tellinger og rangering", () => {
  it("bruker ekte totaltall og paginerer per gruppe", async () => {
    mocks.searchWorkOrderIdsWithTotal.mockResolvedValue({ ids: ["wo-1", "wo-2", "wo-3", "wo-4"], total: 4 });
    mocks.workOrderFindMany.mockResolvedValue([
      workOrderRow({ id: "wo-1", title: "Service 1" }),
      workOrderRow({ id: "wo-2", title: "Service 2" }),
      workOrderRow({ id: "wo-3", title: "Service 3" }),
      workOrderRow({ id: "wo-4", title: "Service 4" }),
    ]);
    mocks.workOrderCount.mockResolvedValue(5);

    const results = await performSearch("service", {
      user: admin,
      page: 2,
      pageSize: 2,
    });
    const group = results.groups.find((item) => item.kind === "workOrder");

    expect(group?.total).toBe(5);
    expect(group?.items).toHaveLength(2);
    expect(results.total).toBeGreaterThanOrEqual(5);
  });

  it("sender alle oppdragsfiltre videre til databasen", async () => {
    mocks.searchWorkOrderIdsWithTotal.mockResolvedValue({ ids: ["wo-1"], total: 1 });
    mocks.workOrderFindMany.mockResolvedValue([workOrderRow()]);
    mocks.workOrderCount.mockResolvedValue(1);

    await performSearch("service", {
      user: admin,
      filters: {
        status: "COMPLETED",
        customer: "cust-1",
        technician: "tech-1",
        tag: "Service",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      },
    });

    const args = mocks.workOrderFindMany.mock.calls[0][0] as {
      where: { AND: unknown[] };
    };
    const json = JSON.stringify(args.where);

    expect(json).toContain('"status":"COMPLETED"');
    expect(json).toContain('"customerId":"cust-1"');
    expect(json).toContain('"technicians":{"some":{"id":"tech-1"}}');
    expect(json).toContain('"tags":{"some":{"name":"Service"}}');
    expect(json).toContain("2026-01-01");
    expect(json).toContain("2026-01-31");
  });

  it("filtrerer rapportene på HMS-type og dato i SQL", async () => {
    await performSearch("sja", {
      user: admin,
      filters: { hmsType: "SJA", dateFrom: "2026-01-01", dateTo: "2026-02-01" },
    });

    const options = mocks.searchReports.mock.calls[0][1] as {
      filters: { hmsType?: string; dateFrom?: string };
    };
    expect(options.filters.hmsType).toBe("SJA");
    expect(options.filters.dateFrom).toBe("2026-01-01");
  });

  it("begrenser oppslaget til valgte gruppetyper", async () => {
    await performSearch("service", {
      user: admin,
      filters: { types: ["report"] },
    });

    expect(mocks.searchReports).toHaveBeenCalled();
    expect(mocks.searchWorkOrderIdsWithTotal).not.toHaveBeenCalled();
    expect(mocks.searchByName).not.toHaveBeenCalled();
  });

  it("sorterer grupper etter beste relevans og gir hvert treff en score", async () => {
    mocks.searchByName.mockImplementation(async (table: string, column: string) => {
      if (table === "Customer" && column === "name") return [{ id: "cust-1", score: 1 }];
      if (table === "WorkOrder" && column === "title") return [{ id: "wo-1", score: 0.3 }];
      return [];
    });
    mocks.customerFindMany.mockResolvedValue([
      { id: "cust-1", name: "Service", customerNumber: null, orgNumber: null, city: null, phone: null, email: null },
    ]);
    mocks.customerCount.mockResolvedValue(1);
    mocks.searchWorkOrderIdsWithTotal.mockResolvedValue({ ids: ["wo-1"], total: 1 });
    mocks.workOrderFindMany.mockResolvedValue([workOrderRow({ title: "Service" })]);
    mocks.workOrderCount.mockResolvedValue(1);

    const results = await performSearch("service", { user: admin });
    const first = results.groups[0];

    expect(first.kind).toBe("customer");
    expect(first.items[0].score).toBeGreaterThan(0);
    for (const group of results.groups) {
      for (const item of group.items) {
        expect(item.score).toBeGreaterThan(0);
      }
    }
  });
  it("bruker normalisert SQL for kontakter, brukere, maler, mapper og kommentarer", async () => {
    mocks.searchNormalizedIds.mockImplementation(async (table: string) => {
      const ids: Record<string, string> = {
        Contact: "contact-1",
        User: "user-2",
        Template: "template-1",
        DocumentFolder: "folder-1",
        Comment: "comment-1",
      };
      return ids[table] ? [{ id: ids[table], score: 0.9 }] : [];
    });

    await performSearch("arlig", { user: admin });

    const tables = mocks.searchNormalizedIds.mock.calls.map((call) => call[0]);
    expect(tables).toEqual(
      expect.arrayContaining(["Contact", "User", "Template", "DocumentFolder", "Comment"]),
    );
    // Ingen av disse gruppene skal falle tilbake på rå `contains` på
    // unormalisert tekst; kandidatene kommer fra det normaliserte SQL-søket.
    expect(mocks.contactFindMany).toHaveBeenCalled();
    expect(mocks.userFindMany).toHaveBeenCalled();
    expect(mocks.templateFindMany).toHaveBeenCalled();
    expect(mocks.folderFindMany).toHaveBeenCalled();
    expect(mocks.commentFindMany).toHaveBeenCalled();
  });

  it("holder brukersøket innenfor aktørens avdeling", async () => {
    const technician = {
      id: "tech-1",
      role: "TECHNICIAN",
      isActive: true,
      departmentId: "dept-2",
      customerId: null,
      permissions: [],
      permissionsCustomized: false,
      roleDefinition: { permissions: ["users.view"] },
    } as unknown as AccessUser;

    mocks.searchNormalizedIds.mockImplementation(async (table: string) => {
      if (table === "User") return [{ id: "user-2", score: 1 }];
      return [];
    });

    await performSearch("kari", { user: technician });

    const args = mocks.userFindMany.mock.calls[0][0] as {
      where: unknown;
    };
    expect(JSON.stringify(args.where)).toContain('"departmentId":"dept-2"');
  });

});

describe("performSearch – alle feltene på kundekortet", () => {
  const customerRow = {
    id: "cust-1",
    name: "Kunde AS",
    customerNumber: "K-100",
    orgNumber: "123456789",
    city: "Oslo",
    phone: "+47 123 45 678",
    email: "post@kunde.no",
    address: "Storgata 1",
    postalCode: "0150",
    notes: "Ring før besøk",
  };

  function useCustomerHit() {
    mocks.searchNormalizedIds.mockImplementation(async (table: string) => {
      if (table === "Customer") return [{ id: "cust-1", score: 1 }];
      return [];
    });
    mocks.customerFindMany.mockResolvedValue([customerRow]);
    mocks.customerCount.mockResolvedValue(1);
  }

  it.each([
    ["orgnummer", "123456789"],
    ["orgnummer med mellomrom", "123 456 789"],
    ["kundenummer", "K-100"],
    ["kundenummer uten bindestrek", "K100"],
    ["telefon med mellomrom", "+47 123 45 678"],
    ["telefon uten mellomrom", "4712345678"],
    ["e-post", "post@kunde.no"],
    ["adresse", "Storgata 1"],
    ["postnummer", "0150"],
  ])("gir kundetreff på %s", async (_label, query) => {
    useCustomerHit();

    const results = await performSearch(query, { user: admin });
    const group = results.groups.find((item) => item.kind === "customer");

    expect(group?.items[0]).toMatchObject({
      id: "cust-1",
      title: "Kunde AS",
      href: "/kunder/cust-1",
    });
    expect(group?.total).toBe(1);
  });

  it("søker i alle kundefeltene via normalisert SQL-søk", async () => {
    useCustomerHit();

    await performSearch("123 456 789", { user: admin });

    expect(mocks.searchNormalizedIds).toHaveBeenCalledWith(
      "Customer",
      "123 456 789",
      expect.any(Number),
    );
  });

  it("utelater slettede kunder", async () => {
    useCustomerHit();

    await performSearch("K-100", { user: admin });

    const args = mocks.customerFindMany.mock.calls[0][0] as {
      where: unknown;
    };
    const json = JSON.stringify(args.where);
    expect(json).toContain('"deletedAt":null');
    expect(json).toContain('"id":{"in":["cust-1"]}');
  });
});

describe("performSearch – dokumentfilnavn", () => {
  it("finner PDF med tegnsetting i filnavnet", async () => {
    mocks.searchDocuments.mockResolvedValue([
      {
        id: "doc-1",
        title: "Faktura 123",
        description: null,
        fileName: "Faktura #123 (kunde).pdf",
        filePath: "/dokumenter/doc-1",
        snippet: null,
        score: 1,
        total: 1,
      },
    ]);
    mocks.documentFindMany.mockResolvedValue([
      {
        id: "doc-1",
        title: "Faktura 123",
        description: null,
        fileName: "Faktura #123 (kunde).pdf",
        filePath: "/dokumenter/doc-1",
        tags: [],
      },
    ]);
    mocks.documentCount.mockResolvedValue(1);

    const results = await performSearch("faktura 123 kunde", { user: admin });
    const group = results.groups.find((item) => item.kind === "document");

    expect(group?.items[0]).toMatchObject({
      id: "doc-1",
      title: "Faktura 123",
    });
    expect(group?.total).toBe(1);

    const args = mocks.documentFindMany.mock.calls[0][0] as {
      where: unknown;
    };
    expect(JSON.stringify(args.where)).toContain('"deletedAt":null');
  });
});
