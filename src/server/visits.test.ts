import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    visit: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/access", () => ({
  staffForDepartment: vi.fn((departmentId: string | null) =>
    departmentId ? { departmentId } : { id: { in: [] } },
  ),
}));

import {
  assignVisit,
  createDefaultVisit,
  createVisit,
  listVisitsForDay,
  listVisitsForWorkOrder,
  moveVisit,
  recomputeWorkOrderSchedule,
  setVisitStatus,
  unassignVisit,
  updateVisit,
  visitRangesOverlap,
} from "./visits";

const STARTS_AT = new Date("2026-10-30T09:00:00.000Z");
const ENDS_AT = new Date("2026-10-30T11:00:00.000Z");

function actor(permissions: string[] = []): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    contactId: null,
    permissionsCustomized: true,
    permissions,
    roleDefinition: null,
  };
}

function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    title: "Årlig service",
    departmentId: "dep-a",
    status: "OPEN",
    legalHold: false,
    ...overrides,
  };
}

function visitContext(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-1",
    workOrderId: "wo-1",
    sequence: 0,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    allDay: false,
    status: "PLANNED",
    notes: null,
    technicians: [{ userId: "tech-1", user: { name: "Tore Montør" } }],
    workOrder: workOrder(),
    ...overrides,
  };
}

function visitModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-1",
    workOrderId: "wo-1",
    sequence: 0,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    allDay: false,
    status: "PLANNED",
    notes: null,
    createdAt: STARTS_AT,
    updatedAt: STARTS_AT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.prisma.$transaction.mockImplementation(
    async (callback: (client: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
  mocks.prisma.workOrder.update.mockResolvedValue({});
  mocks.prisma.visit.findFirst.mockResolvedValue(visitContext());
  mocks.prisma.visit.findMany.mockResolvedValue([]);
  mocks.prisma.visit.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) =>
      visitModel({ ...data, id: "visit-new" }),
  );
  mocks.prisma.visit.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) =>
      visitModel({ ...data }),
  );
  mocks.prisma.visit.delete.mockResolvedValue({});
  mocks.prisma.visit.aggregate.mockResolvedValue({
    _min: { startsAt: null },
    _max: { endsAt: null },
  });
  mocks.prisma.user.findMany.mockImplementation(
    async ({ where }: { where: { id?: { in?: string[] } } }) =>
      (where.id?.in ?? []).map((id) => ({ id, name: `Montør ${id}` })),
  );
  mocks.audit.mockResolvedValue(undefined);
});

describe("visitRangesOverlap", () => {
  const baseStart = new Date("2026-10-30T09:00:00.000Z");
  const baseEnd = new Date("2026-10-30T11:00:00.000Z");

  it("oppdager overlapp i begge retninger", () => {
    expect(
      visitRangesOverlap(
        { startsAt: baseStart, endsAt: baseEnd },
        {
          startsAt: new Date("2026-10-30T10:00:00.000Z"),
          endsAt: new Date("2026-10-30T12:00:00.000Z"),
        },
      ),
    ).toBe(true);
    expect(
      visitRangesOverlap(
        {
          startsAt: new Date("2026-10-30T08:00:00.000Z"),
          endsAt: new Date("2026-10-30T10:00:00.000Z"),
        },
        { startsAt: baseStart, endsAt: baseEnd },
      ),
    ).toBe(true);
  });

  it("behandler intervaller som møtes i endepunktet som ikke-overlappende", () => {
    expect(
      visitRangesOverlap(
        { startsAt: baseStart, endsAt: baseEnd },
        {
          startsAt: baseEnd,
          endsAt: new Date("2026-10-30T13:00:00.000Z"),
        },
      ),
    ).toBe(false);
    expect(
      visitRangesOverlap(
        {
          startsAt: new Date("2026-10-30T07:00:00.000Z"),
          endsAt: baseStart,
        },
        { startsAt: baseStart, endsAt: baseEnd },
      ),
    ).toBe(false);
  });

  it("oppdager at et kort intervall ligger inne i et annet", () => {
    expect(
      visitRangesOverlap(
        { startsAt: baseStart, endsAt: baseEnd },
        {
          startsAt: new Date("2026-10-30T09:30:00.000Z"),
          endsAt: new Date("2026-10-30T10:30:00.000Z"),
        },
      ),
    ).toBe(true);
  });
});

describe("createVisit", () => {
  it("avviser aktør uten workorders.edit før databasen røres", async () => {
    const result = await createVisit(actor(["workorders.view"]), {
      workOrderId: "wo-1",
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser en montør som er tildelt en overlappende visitt", async () => {
    const conflictStart = new Date("2026-10-30T10:00:00.000Z");
    const conflictEnd = new Date("2026-10-30T12:00:00.000Z");
    mocks.prisma.visit.findMany.mockResolvedValue([
      {
        id: "visit-2",
        workOrderId: "wo-2",
        startsAt: conflictStart,
        endsAt: conflictEnd,
        technicians: [{ userId: "tech-1" }],
      },
    ]);

    const result = await createVisit(actor(["workorders.edit"]), {
      workOrderId: "wo-1",
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      technicianIds: ["tech-1"],
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      details: {
        code: "visits.errors.overlap",
        conflicts: [
          {
            visitId: "visit-2",
            workOrderId: "wo-2",
            startsAt: conflictStart.toISOString(),
            endsAt: conflictEnd.toISOString(),
            technicianIds: ["tech-1"],
          },
        ],
      },
    });
    expect(mocks.prisma.visit.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("avviser en montør utenfor oppdragets avdeling", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([]);

    const result = await createVisit(actor(["workorders.edit"]), {
      workOrderId: "wo-1",
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      technicianIds: ["tech-other"],
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      details: {
        code: "visits.errors.invalidTechnician",
        technicianIds: ["tech-other"],
      },
    });
    expect(mocks.prisma.visit.create).not.toHaveBeenCalled();
  });

  it("avviser slutttid før starttid og for lang varighet", async () => {
    await expect(
      createVisit(actor(["workorders.edit"]), {
        workOrderId: "wo-1",
        startsAt: STARTS_AT,
        endsAt: STARTS_AT,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid",
      details: { code: "visits.errors.invalidTimeRange" },
    });

    await expect(
      createVisit(actor(["workorders.edit"]), {
        workOrderId: "wo-1",
        startsAt: STARTS_AT,
        endsAt: new Date(STARTS_AT.getTime() + 32 * 24 * 60 * 60 * 1000),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid",
      details: { code: "visits.errors.durationTooLong" },
    });
  });
});

describe("status og sperrer", () => {
  it("bytter status etter tilstandsmaskinen og logger i transaksjonen", async () => {
    mocks.prisma.visit.update.mockResolvedValue(
      visitModel({ status: "ASSIGNED" }),
    );

    const result = await setVisitStatus(
      actor(["workorders.update"]),
      "visit-1",
      "ASSIGNED",
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ status: "ASSIGNED" }),
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.visit.update).toHaveBeenCalledWith({
      where: { id: "visit-1" },
      data: { status: "ASSIGNED" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "Visit",
        entityId: "visit-1",
        action: "Endret visittstatus: PLANNED → ASSIGNED",
        metadata: expect.objectContaining({
          workOrderId: "wo-1",
          workOrderTitle: "Årlig service",
          from: "PLANNED",
          to: "ASSIGNED",
        }),
      }),
    );
    // Revisjonsloggen fikk transaksjonsklienten, ikke en egen tilkobling.
    expect(mocks.audit.mock.calls[0][0]).toBe(mocks.prisma);
    expect(mocks.prisma.visit.aggregate).toHaveBeenCalled();
  });

  it("avviser en statusovergang som ikke finnes i flyten", async () => {
    const result = await setVisitStatus(
      actor(["workorders.update"]),
      "visit-1",
      "DONE",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      details: {
        code: "visits.errors.statusTransition",
        from: "PLANNED",
        to: "DONE",
      },
    });
    expect(mocks.prisma.visit.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("sperrer flytting når oppdraget har bevaringsplikt", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(
      visitContext({ workOrder: workOrder({ legalHold: true }) }),
    );

    const result = await moveVisit(actor(["workorders.assign"]), "visit-1", {
      startsAt: new Date("2026-10-31T09:00:00.000Z"),
      endsAt: new Date("2026-10-31T11:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      details: { code: "visits.errors.legalHold" },
    });
    expect(mocks.prisma.visit.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("sperrer endring av en avsluttet visitt", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(
      visitContext({ status: "DONE" }),
    );

    const result = await updateVisit(actor(["workorders.edit"]), "visit-1", {
      notes: "Ny merknad",
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      details: { code: "visits.errors.visitLocked" },
    });
    expect(mocks.prisma.visit.update).not.toHaveBeenCalled();
  });
});

describe("assignVisit / unassignVisit", () => {
  it("tildeler montører og logger navnene", async () => {
    const result = await assignVisit(actor(["workorders.assign"]), "visit-1", [
      "tech-1",
      "tech-2",
    ]);

    expect(result.ok).toBe(true);
    expect(mocks.prisma.visit.update).toHaveBeenCalledWith({
      where: { id: "visit-1" },
      data: {
        technicians: {
          deleteMany: {},
          create: [{ userId: "tech-1" }, { userId: "tech-2" }],
        },
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        action: "Tildelte montør: Montør tech-1, Montør tech-2",
        metadata: expect.objectContaining({
          technicianIds: {
            from: ["tech-1"],
            to: ["tech-1", "tech-2"],
          },
        }),
      }),
    );
  });

  it("fjerner bare den angitte montøren", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(
      visitContext({
        technicians: [
          { userId: "tech-1", user: { name: "Tore" } },
          { userId: "tech-2", user: { name: "Kari" } },
        ],
      }),
    );

    await unassignVisit(actor(["workorders.assign"]), "visit-1", "tech-2");

    expect(mocks.prisma.visit.update).toHaveBeenCalledWith({
      where: { id: "visit-1" },
      data: { technicians: { deleteMany: { userId: { in: ["tech-2"] } } } },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({ action: "Fjernet montør: Kari" }),
    );
  });
});

describe("recomputeWorkOrderSchedule", () => {
  it("bruker Oslo-datoer og siste inkluderte dag", async () => {
    mocks.prisma.visit.aggregate.mockResolvedValue({
      _min: { startsAt: new Date("2026-10-30T23:30:00.000Z") },
      _max: { endsAt: new Date("2026-10-31T23:30:00.000Z") },
    });

    await recomputeWorkOrderSchedule(
      mocks.prisma as unknown as Prisma.TransactionClient,
      "wo-1",
    );

    expect(mocks.prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: {
        scheduledFor: new Date("2026-10-31T00:00:00.000Z"),
        scheduledTo: new Date("2026-11-01T00:00:00.000Z"),
      },
    });
  });

  it("gir ikke en ekstra dag for en heldagsvisitt som slutter ved midnatt", async () => {
    mocks.prisma.visit.aggregate.mockResolvedValue({
      _min: { startsAt: new Date("2026-10-29T23:00:00.000Z") },
      _max: { endsAt: new Date("2026-10-30T23:00:00.000Z") },
    });

    await recomputeWorkOrderSchedule(
      mocks.prisma as unknown as Prisma.TransactionClient,
      "wo-1",
    );

    expect(mocks.prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: {
        scheduledFor: new Date("2026-10-30T00:00:00.000Z"),
        scheduledTo: new Date("2026-10-30T00:00:00.000Z"),
      },
    });
  });

  it("tømmer datoperioden når det ikke finnes aktive visiter", async () => {
    await recomputeWorkOrderSchedule(
      mocks.prisma as unknown as Prisma.TransactionClient,
      "wo-1",
    );

    expect(mocks.prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { scheduledFor: null, scheduledTo: null },
    });
  });
});

describe("createDefaultVisit", () => {
  it("lager én heldagsvisitt med Oslo-midnatt og montører", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(null);

    await createDefaultVisit(
      mocks.prisma as unknown as Prisma.TransactionClient,
      {
        workOrderId: "wo-1",
        // Kalenderen sender rene datoer som UTC-midnatt, med eksklusiv slutt.
        startsAt: new Date("2026-10-30T00:00:00.000Z"),
        endsAt: new Date("2026-10-31T00:00:00.000Z"),
        technicianIds: ["tech-1"],
      },
    );

    expect(mocks.prisma.visit.create).toHaveBeenCalledWith({
      data: {
        workOrderId: "wo-1",
        sequence: 0,
        startsAt: new Date("2026-10-29T23:00:00.000Z"),
        endsAt: new Date("2026-10-30T23:00:00.000Z"),
        allDay: true,
        status: "PLANNED",
        technicians: { create: [{ userId: "tech-1" }] },
      },
    });
    expect(mocks.prisma.visit.aggregate).toHaveBeenCalled();
  });

  it("tolker samme kalenderdato som én heldagsvisitt", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(null);

    await createDefaultVisit(
      mocks.prisma as unknown as Prisma.TransactionClient,
      {
        workOrderId: "wo-1",
        startsAt: new Date("2026-10-30T00:00:00.000Z"),
        endsAt: new Date("2026-10-30T00:00:00.000Z"),
      },
    );

    expect(mocks.prisma.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startsAt: new Date("2026-10-29T23:00:00.000Z"),
        endsAt: new Date("2026-10-30T23:00:00.000Z"),
      }),
    });
  });

  it("lager ikke en identisk heldagsvisitt på nytt", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue({ id: "visit-existing" });

    await createDefaultVisit(
      mocks.prisma as unknown as Prisma.TransactionClient,
      {
        workOrderId: "wo-1",
        startsAt: new Date("2026-10-30T00:00:00.000Z"),
        endsAt: new Date("2026-10-31T00:00:00.000Z"),
      },
    );

    expect(mocks.prisma.visit.create).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.update).toHaveBeenCalled();
  });
});

describe("listefunksjoner", () => {
  it("henter oppdragets visiter med avgrenset take og avdelingsscope", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({ id: "wo-1" });

    const result = await listVisitsForWorkOrder(
      actor(["workorders.view"]),
      "wo-1",
    );

    expect(result).toEqual({ ok: true, data: [] });
    expect(mocks.prisma.visit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { startsAt: "asc" },
        take: 100,
        where: {
          workOrderId: "wo-1",
          workOrder: {
            AND: [
              {
                departmentId: "dep-a",
                department: { isActive: true },
                deletedAt: null,
              },
            ],
          },
        },
      }),
    );
  });

  it("henter dagen med halvåpent intervall og take 500", async () => {
    const from = new Date("2026-10-30T00:00:00.000Z");
    const to = new Date("2026-10-31T00:00:00.000Z");

    const result = await listVisitsForDay(
      actor(["workorders.view"]),
      from,
      to,
    );

    expect(result).toEqual({ ok: true, data: [] });
    expect(mocks.prisma.visit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { startsAt: "asc" },
        take: 500,
        where: expect.objectContaining({
          startsAt: { lt: to },
          endsAt: { gt: from },
          workOrder: { AND: [expect.objectContaining({ departmentId: "dep-a" })] },
        }),
      }),
    );
  });

  it("avviser lesing uten workorders.view", async () => {
    const result = await listVisitsForDay(
      actor([]),
      new Date("2026-10-30T00:00:00.000Z"),
      new Date("2026-10-31T00:00:00.000Z"),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.visit.findMany).not.toHaveBeenCalled();
  });
});
