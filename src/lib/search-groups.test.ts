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
  searchByName: vi.fn<
    (table: string, column: string, query: string, limit: number) => Promise<{ id: string; score: number }[]>
  >(async () => []),
  searchBySubstring: vi.fn<
    (table: string, column: string, query: string, limit: number) => Promise<{ id: string; score: number }[]>
  >(async () => []),
  searchDocuments: vi.fn<(query: string, limit: number) => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    customer: { findMany: mocks.customerFindMany },
    contact: { findMany: mocks.contactFindMany },
    product: { findMany: mocks.productFindMany },
    workOrder: { findMany: mocks.workOrderFindMany },
    tag: { findMany: mocks.tagFindMany },
    report: { findMany: mocks.reportFindMany },
    comment: { findMany: mocks.commentFindMany },
    user: { findMany: mocks.userFindMany },
    template: { findMany: mocks.templateFindMany },
    documentFolder: { findMany: mocks.folderFindMany },
    document: { findMany: mocks.documentFindMany },
  },
}));

vi.mock("@/lib/search-sql", () => ({
  searchByName: mocks.searchByName,
  searchBySubstring: mocks.searchBySubstring,
  searchDocuments: mocks.searchDocuments,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.customerFindMany.mockResolvedValue([]);
  mocks.contactFindMany.mockResolvedValue([]);
  mocks.productFindMany.mockResolvedValue([]);
  mocks.workOrderFindMany.mockResolvedValue([]);
  mocks.tagFindMany.mockResolvedValue([]);
  mocks.reportFindMany.mockResolvedValue([]);
  mocks.commentFindMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.templateFindMany.mockResolvedValue([]);
  mocks.folderFindMany.mockResolvedValue([]);
  mocks.documentFindMany.mockResolvedValue([]);
  mocks.searchByName.mockResolvedValue([]);
  mocks.searchBySubstring.mockResolvedValue([]);
  mocks.searchDocuments.mockResolvedValue([]);
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
    mocks.workOrderFindMany.mockResolvedValue([
      {
        id: "wo-1",
        title: "Service",
        orderNumber: "NO-2026-1042",
        description: null,
        creatorName: null,
        status: "PLANNED",
        scheduledFor: null,
        customer: { name: "Kunde AS" },
        tags: [{ id: "tag-1", name: "Årlig service", color: "#3b82f6" }],
      },
    ]);

    const results = await performSearch("arlig-service", { user: admin });

    const tagGroup = results.groups.find((group) => group.kind === "tag");
    expect(tagGroup?.items[0]).toMatchObject({
      title: "Årlig service",
      href: "/oppdrag?tag=%C3%85rlig%20service",
    });

    const workOrderGroup = results.groups.find((group) => group.kind === "workOrder");
    expect(workOrderGroup?.items[0].title).toContain("NO-2026-1042");
    expect(workOrderGroup?.items[0].subtitle).toContain("Årlig service");

    // Tag-treffet gir også oppdraget, selv uten treff i tittel/ordrenummer.
    const workOrderWhere = mocks.workOrderFindMany.mock.calls[0][0] as {
      where: { AND: unknown[] };
    };
    expect(JSON.stringify(workOrderWhere.where)).toContain('"tags"');
  });

  it("søker i ordrenummer med normalisert delstreng", async () => {
    mocks.searchBySubstring.mockImplementation(async (table: string, column: string) => {
      if (table === "WorkOrder" && column === "orderNumber") {
        return [{ id: "wo-2", score: 1 }];
      }
      return [];
    });
    mocks.workOrderFindMany.mockResolvedValue([
      {
        id: "wo-2",
        title: "Kontroll",
        orderNumber: "NO-2026-1042",
        description: null,
        creatorName: null,
        status: "PLANNED",
        scheduledFor: null,
        customer: null,
        tags: [],
      },
    ]);

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

  it("henter rapporter uten avdelingsfilter", async () => {
    await performSearch("pumpe", { user: admin });

    const reportArgs = mocks.reportFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    const json = JSON.stringify(reportArgs.where);

    expect(json).toContain('"deletedAt":null');
    expect(json).not.toContain("departmentId");
  });
});
