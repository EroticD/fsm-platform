import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    savedSearch: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
    },
  },
}));

import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  updateSavedSearch,
} from "./saved-searches";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: [] },
    ...overrides,
  };
}

const row = {
  id: "saved-1",
  userId: "u1",
  name: "HMS pumpe",
  query: "pumpe",
  filters: { status: "COMPLETED" },
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockResolvedValue(row);
  mocks.update.mockResolvedValue(row);
  mocks.delete.mockResolvedValue(row);
});

describe("listSavedSearches", () => {
  it("lister bare aktørens egne søk", async () => {
    mocks.findMany.mockResolvedValue([row]);
    const result = await listSavedSearches(actor());

    expect(result.ok).toBe(true);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { updatedAt: "desc" },
    });
    if (result.ok) {
      expect(result.data[0]).toMatchObject({
        id: "saved-1",
        name: "HMS pumpe",
        filters: { status: "COMPLETED" },
      });
    }
  });

  it("avviser kundeportal og inaktive brukere", async () => {
    await expect(listSavedSearches(actor({ role: "CUSTOMER" }))).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    await expect(listSavedSearches(actor({ isActive: false }))).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });
});

describe("createSavedSearch", () => {
  it("validerer og lagrer navn, query og rensede filtre", async () => {
    const result = await createSavedSearch(actor(), {
      name: "  Pumpe  ",
      query: "  pumpe  ",
      filters: { status: "COMPLETED", hmsType: "SJA", customer: "<script>" },
    });

    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        name: "Pumpe",
        query: "pumpe",
        filters: { status: "COMPLETED", hmsType: "SJA" },
      },
    });
  });

  it("avviser tomme og for lange verdier", async () => {
    await expect(
      createSavedSearch(actor(), { name: "", query: "pumpe" }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      createSavedSearch(actor(), { name: "x".repeat(81), query: "pumpe" }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      createSavedSearch(actor(), { name: "Pumpe", query: "x".repeat(101) }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("gir konflikt når navnet allerede finnes for brukeren", async () => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("unik"), { code: "P2002" }));

    await expect(
      createSavedSearch(actor(), { name: "Pumpe", query: "pumpe" }),
    ).resolves.toMatchObject({ ok: false, reason: "conflict" });
  });

  it("lagrer uten filtre som SQL-null", async () => {
    await createSavedSearch(actor(), { name: "Alt", query: "service", filters: {} });
    expect(mocks.create.mock.calls[0][0].data.filters).toBeDefined();
    expect(mocks.create.mock.calls[0][0].data.filters).not.toEqual({});
  });
});

describe("updateSavedSearch", () => {
  it("oppdaterer bare egne søk", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(
      updateSavedSearch(actor(), "saved-2", { name: "Nytt", query: "nytt" }),
    ).resolves.toMatchObject({ ok: false, reason: "not_found" });
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.findFirst.mockResolvedValueOnce({ id: "saved-1" });
    const result = await updateSavedSearch(actor(), "saved-1", {
      name: "Nytt",
      query: "nytt",
    });
    expect(result.ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "saved-1" },
      data: expect.objectContaining({ name: "Nytt", query: "nytt" }),
    });
  });

  it("gir konflikt ved duplikat navn", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "saved-1" });
    mocks.update.mockRejectedValueOnce(Object.assign(new Error("unik"), { code: "P2002" }));

    await expect(
      updateSavedSearch(actor(), "saved-1", { name: "Pumpe", query: "pumpe" }),
    ).resolves.toMatchObject({ ok: false, reason: "conflict" });
  });
});

describe("deleteSavedSearch", () => {
  it("sletter bare egne søk", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "saved-1" });
    await expect(deleteSavedSearch(actor(), "saved-1")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: "saved-1" } });

    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(deleteSavedSearch(actor(), "saved-9")).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });
});
