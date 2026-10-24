import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: { findFirst: vi.fn() },
    timeEntry: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import {
  addManualTime,
  deleteTimeEntry,
  getTimeTotals,
  listTimeEntries,
  startTimer,
  stopTimer,
} from "./time";

const admin = (overrides: Partial<ServiceActor> = {}): ServiceActor => ({
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: "dep-a",
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
  ...overrides,
});

const noAccess = () =>
  admin({
    role: "USER",
    permissionsCustomized: true,
    permissions: [],
    roleDefinition: { permissions: [] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.workOrder.findFirst.mockResolvedValue({ id: "wo1" });
  mocks.prisma.timeEntry.findFirst.mockResolvedValue(null);
  mocks.prisma.timeEntry.findMany.mockResolvedValue([]);
  mocks.prisma.timeEntry.create.mockResolvedValue({ id: "te1" });
  mocks.prisma.timeEntry.update.mockResolvedValue({});
  mocks.prisma.timeEntry.delete.mockResolvedValue({});
});

describe("time-tjenesten", () => {
  it("avviser start uten workorders.update", async () => {
    const result = await startTimer(noAccess(), { workOrderId: "wo1" });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("avviser en ny timer når brukeren allerede har en aktiv", async () => {
    mocks.prisma.timeEntry.findFirst.mockResolvedValue({ id: "aktiv" });
    const result = await startTimer(admin(), { workOrderId: "wo1" });
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mocks.prisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("starter og logger en timer", async () => {
    const result = await startTimer(admin(), {
      workOrderId: "wo1",
      description: "Feilsøking",
    });
    expect(result).toEqual({ ok: true, data: { id: "te1" } });
    expect(mocks.prisma.timeEntry.create).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("beregner minutter ved manuell registrering", async () => {
    const start = new Date("2026-10-24T08:00:00Z");
    const end = new Date("2026-10-24T09:30:00Z");
    const result = await addManualTime(admin(), {
      workOrderId: "wo1",
      startedAt: start,
      endedAt: end,
    });
    expect(result).toEqual({ ok: true, data: { id: "te1", minutes: 90 } });
    expect(mocks.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ minutes: 90 }),
      }),
    );
  });

  it("avviser ugyldig manuell registrering", async () => {
    const result = await addManualTime(admin(), {
      workOrderId: "wo1",
      startedAt: new Date("2026-10-24T09:00:00Z"),
      endedAt: new Date("2026-10-24T08:00:00Z"),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("stoppet timer bare for eier eller administrator", async () => {
    mocks.prisma.timeEntry.findUnique.mockResolvedValue({
      id: "te1",
      userId: "annen",
      workOrderId: "wo1",
      startedAt: new Date(),
      endedAt: null,
    });

    const result = await stopTimer(admin({ id: "u1", role: "TECHNICIAN" }), {
      id: "te1",
    });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("summerer minutter og beløp", async () => {
    mocks.prisma.timeEntry.findMany.mockResolvedValue([
      { minutes: 60, billable: true, hourlyRate: 1000 },
      { minutes: 30, billable: false, hourlyRate: 1000 },
      { minutes: 30, billable: true, hourlyRate: 800 },
    ]);

    const result = await getTimeTotals(admin(), "wo1");
    expect(result).toEqual({
      ok: true,
      data: { minutes: 120, billableMinutes: 90, amount: 1400 },
    });
  });

  it("avviser sletting av andres timer for tekniker", async () => {
    mocks.prisma.timeEntry.findUnique.mockResolvedValue({
      id: "te1",
      userId: "annen",
      workOrderId: "wo1",
    });

    const result = await deleteTimeEntry(admin({ role: "TECHNICIAN" }), {
      id: "te1",
    });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.timeEntry.delete).not.toHaveBeenCalled();
  });

  it("lister timer for et oppdrag", async () => {
    mocks.prisma.timeEntry.findMany.mockResolvedValue([{ id: "te1" }]);
    const result = await listTimeEntries(admin(), "wo1");
    expect(result).toEqual({ ok: true, data: [{ id: "te1" }] });
  });
});
