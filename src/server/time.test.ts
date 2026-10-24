import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  updateTimeEntry,
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

const technician = (overrides: Partial<ServiceActor> = {}) =>
  admin({
    id: "tech",
    name: "Montør",
    email: "montor@example.test",
    role: "TECHNICIAN",
    ...overrides,
  });

const originalDefaultRate = process.env.DEFAULT_HOURLY_RATE;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEFAULT_HOURLY_RATE;
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

afterEach(() => {
  if (originalDefaultRate === undefined) {
    delete process.env.DEFAULT_HOURLY_RATE;
  } else {
    process.env.DEFAULT_HOURLY_RATE = originalDefaultRate;
  }
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
    expect(mocks.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activeKey: "u1" }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("gir konflikt når to starter kolliderer på aktiv-nøkkelen", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce({ code: "P2002" });

    const result = await startTimer(admin(), { workOrderId: "wo1" });
    expect(result).toEqual({ ok: false, reason: "conflict" });
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

  it("avviser manuell registrering over 24 timer", async () => {
    const result = await addManualTime(admin(), {
      workOrderId: "wo1",
      startedAt: new Date("2026-10-23T08:00:00Z"),
      endedAt: new Date("2026-10-24T09:00:00Z"),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("avviser overlappende registrering for samme bruker", async () => {
    mocks.prisma.timeEntry.findFirst.mockResolvedValue({ id: "annen" });

    const result = await addManualTime(admin(), {
      workOrderId: "wo1",
      startedAt: new Date("2026-10-24T08:00:00Z"),
      endedAt: new Date("2026-10-24T09:00:00Z"),
    });
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mocks.prisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("tekniker får avtalt/kunde-pris i stedet for innsendt timepris", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      contract: { hourlyRate: 1200 },
      customer: { hourlyRate: 900 },
    });

    const result = await addManualTime(technician(), {
      workOrderId: "wo1",
      startedAt: new Date("2026-10-24T08:00:00Z"),
      endedAt: new Date("2026-10-24T09:00:00Z"),
      hourlyRate: 1,
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hourlyRate: 1200 }),
      }),
    );
    const auditMetadata = mocks.audit.mock.calls.at(-1)?.[1]?.metadata;
    expect(auditMetadata).not.toHaveProperty("hourlyRate");
  });

  it("kontoret kan overstyre timepris, og loggen har før/etter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      contract: { hourlyRate: 1200 },
      customer: { hourlyRate: 900 },
    });

    const result = await addManualTime(admin({ role: "OFFICE" }), {
      workOrderId: "wo1",
      startedAt: new Date("2026-10-24T08:00:00Z"),
      endedAt: new Date("2026-10-24T09:00:00Z"),
      hourlyRate: 1500,
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hourlyRate: 1500 }),
      }),
    );
    const auditMetadata = mocks.audit.mock.calls.at(-1)?.[1]?.metadata;
    expect(auditMetadata).toMatchObject({
      hourlyRate: { before: 1200, after: 1500 },
    });
  });

  it("bruker standardpris fra miljøet når avtale og kunde mangler pris", async () => {
    process.env.DEFAULT_HOURLY_RATE = "750";

    await addManualTime(technician(), {
      workOrderId: "wo1",
      startedAt: new Date("2026-10-24T08:00:00Z"),
      endedAt: new Date("2026-10-24T09:00:00Z"),
      hourlyRate: 1,
    });

    expect(mocks.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hourlyRate: 750 }),
      }),
    );
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

  it("stopper timeren, tømmer aktiv-nøkkelen og kapper varigheten til 24 timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    try {
      mocks.prisma.timeEntry.findUnique.mockResolvedValue({
        id: "te1",
        userId: "u1",
        workOrderId: "wo1",
        startedAt: new Date("2026-10-23T12:00:00Z"),
        endedAt: null,
      });

      const result = await stopTimer(admin(), { id: "te1" });
      expect(result).toEqual({ ok: true, data: { minutes: 1440 } });
      expect(mocks.prisma.timeEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ minutes: 1440, activeKey: null }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("avviser timer som starter i fremtiden", async () => {
    mocks.prisma.timeEntry.findUnique.mockResolvedValue({
      id: "te1",
      userId: "u1",
      workOrderId: "wo1",
      startedAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endedAt: null,
    });

    const result = await stopTimer(admin(), { id: "te1" });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.timeEntry.update).not.toHaveBeenCalled();
  });

  it("avviser oppdatering over 24 timer", async () => {
    mocks.prisma.timeEntry.findUnique.mockResolvedValue({
      id: "te1",
      userId: "u1",
      workOrderId: "wo1",
      startedAt: new Date("2026-10-23T08:00:00Z"),
      endedAt: null,
      minutes: 60,
      hourlyRate: 1000,
    });

    const result = await updateTimeEntry(admin(), {
      id: "te1",
      endedAt: new Date("2026-10-24T09:00:00Z"),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.timeEntry.update).not.toHaveBeenCalled();
  });

  it("tekniker kan ikke endre timepris ved oppdatering", async () => {
    mocks.prisma.timeEntry.findUnique.mockResolvedValue({
      id: "te1",
      userId: "tech",
      workOrderId: "wo1",
      startedAt: new Date("2026-10-24T08:00:00Z"),
      endedAt: new Date("2026-10-24T09:00:00Z"),
      minutes: 60,
      hourlyRate: 1200,
    });

    const result = await updateTimeEntry(technician(), {
      id: "te1",
      description: "Endret",
      hourlyRate: 1,
    });

    expect(result.ok).toBe(true);
    const updateData = mocks.prisma.timeEntry.update.mock.calls[0]?.[0]?.data;
    expect(updateData).not.toHaveProperty("hourlyRate");
    const auditMetadata = mocks.audit.mock.calls.at(-1)?.[1]?.metadata;
    expect(auditMetadata).not.toHaveProperty("hourlyRate");
  });

  it("kontoret kan overstyre timepris ved oppdatering med før/etter i loggen", async () => {
    mocks.prisma.timeEntry.findUnique.mockResolvedValue({
      id: "te1",
      userId: "tech",
      workOrderId: "wo1",
      startedAt: new Date("2026-10-24T08:00:00Z"),
      endedAt: new Date("2026-10-24T09:00:00Z"),
      minutes: 60,
      hourlyRate: 1200,
    });

    const result = await updateTimeEntry(admin({ role: "OFFICE" }), {
      id: "te1",
      hourlyRate: 1500,
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.timeEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hourlyRate: 1500 }),
      }),
    );
    const auditMetadata = mocks.audit.mock.calls.at(-1)?.[1]?.metadata;
    expect(auditMetadata).toMatchObject({
      hourlyRate: { before: 1200, after: 1500 },
    });
  });

  it("summerer minutter og beløp", async () => {
    mocks.prisma.timeEntry.findMany.mockResolvedValue([
      { userId: "u1", minutes: 60, billable: true, hourlyRate: 1000 },
      { userId: "u1", minutes: 30, billable: false, hourlyRate: 1000 },
      { userId: "u1", minutes: 30, billable: true, hourlyRate: 800 },
    ]);

    const result = await getTimeTotals(admin(), "wo1");
    expect(result).toEqual({
      ok: true,
      data: { minutes: 120, billableMinutes: 90, amount: 1400 },
    });
  });

  it("tekniker får ikke andre brukeres timepris i summen", async () => {
    mocks.prisma.timeEntry.findMany.mockResolvedValue([
      { userId: "annen", minutes: 60, billable: true, hourlyRate: 2000 },
      { userId: "tech", minutes: 60, billable: true, hourlyRate: 1000 },
    ]);

    const result = await getTimeTotals(technician(), "wo1");
    expect(result).toEqual({
      ok: true,
      data: { minutes: 120, billableMinutes: 120, amount: 1000 },
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
    mocks.prisma.timeEntry.findMany.mockResolvedValue([
      { id: "te1", userId: "u1", hourlyRate: 1000 },
    ]);
    const result = await listTimeEntries(admin(), "wo1");
    expect(result).toEqual({
      ok: true,
      data: [{ id: "te1", userId: "u1", hourlyRate: 1000 }],
    });
  });

  it("skjuler andre brukeres timepris for tekniker, men viser egen", async () => {
    mocks.prisma.timeEntry.findMany.mockResolvedValue([
      { id: "andre", userId: "annen", hourlyRate: 2000 },
      { id: "egen", userId: "tech", hourlyRate: 1000 },
    ]);

    const result = await listTimeEntries(technician(), "wo1");
    expect(result.ok).toBe(true);
    const data = result.ok ? (result.data as Array<Record<string, unknown>>) : [];
    expect(data.find((entry) => entry.id === "andre")?.hourlyRate).toBeNull();
    expect(data.find((entry) => entry.id === "egen")?.hourlyRate).toBe(1000);
  });
});
