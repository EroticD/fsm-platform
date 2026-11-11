import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, WorkStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/server/sla", () => ({
  markResolved: vi.fn(async () => undefined),
  cancelClocks: vi.fn(async () => undefined),
}));
vi.mock("@/lib/work-order-schedule", () => ({
  recomputeWorkOrderSchedule: vi.fn(async () => undefined),
}));

import { transitionWorkOrderStatus } from "./work-order-status-action";
import { cancelClocks, markResolved } from "@/server/sla";
import {
  DEFAULT_WORK_ORDER_STATUS_CONFIG,
  setWorkOrderStatusConfig,
} from "./work-order-status";

const actor = { id: "u1", name: "Kari", email: "kari@example.com" };

function call(from: WorkStatus, to: WorkStatus, isAdmin = false) {
  return transitionWorkOrderStatus({
    workOrderId: "wo-1",
    from,
    to,
    isAdmin,
    actor,
    action: "Endret status",
  });
}

function makeTx() {
  return {
    workOrder: { updateMany: vi.fn(async () => ({ count: 1 })) },
    visit: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
      findMany: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
      update: vi.fn(async () => ({})),
    },
    trackingLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
}

function useTx(tx: ReturnType<typeof makeTx>) {
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (client: typeof tx) => unknown) => callback(tx),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  setWorkOrderStatusConfig(DEFAULT_WORK_ORDER_STATUS_CONFIG);
});

describe("transitionWorkOrderStatus", () => {
  it("avviser en overgang til samme status uten å skrive til databasen", async () => {
    const result = await call("OPEN", "OPEN");

    expect(result).toEqual({ ok: false, error: "ugyldig-status" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lar et åpent oppdrag fullføres uten å kreve lineær rekkefølge", async () => {
    const tx = makeTx();
    useTx(tx);

    const result = await call("OPEN", "COMPLETED");

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "wo-1", status: "OPEN" },
      data: { status: "COMPLETED" },
    });
    expect(markResolved).toHaveBeenCalledWith(tx, "wo-1", expect.any(Date));
  });

  it("lukker aktive visiter og returkjøring når oppdraget fullføres", async () => {
    const tx = makeTx();
    useTx(tx);

    const result = await call("OPEN", "COMPLETED");

    expect(result).toEqual({ ok: true });
    expect(tx.visit.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        workOrderId: "wo-1",
        status: { in: ["EN_ROUTE", "ON_SITE"] },
        doneAt: null,
      },
      data: { status: "DONE", doneAt: expect.any(Date), autoClosedAt: expect.any(Date) },
    });
    expect(tx.visit.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        workOrderId: "wo-1",
        status: { in: ["EN_ROUTE", "ON_SITE"] },
      },
      data: { status: "DONE", autoClosedAt: expect.any(Date) },
    });
    expect(tx.visit.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        workOrderId: "wo-1",
        status: "DONE",
        travelFromEndedAt: null,
      },
      data: { travelFromEndedAt: expect.any(Date) },
    });
    expect(tx.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { workOrderId: "wo-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("kansellerer planlagte og aktive visiter når oppdraget kanselleres", async () => {
    const tx = makeTx();
    useTx(tx);

    const result = await call("OPEN", "CANCELLED");

    expect(result).toEqual({ ok: true });
    expect(cancelClocks).toHaveBeenCalledWith(tx, "wo-1", expect.any(Date));
    expect(tx.visit.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        workOrderId: "wo-1",
        status: { in: ["EN_ROUTE", "ON_SITE"] },
        travelFromEndedAt: null,
      },
      data: { travelFromEndedAt: expect.any(Date) },
    });
    expect(tx.visit.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        workOrderId: "wo-1",
        status: { in: ["PLANNED", "ASSIGNED", "EN_ROUTE", "ON_SITE"] },
      },
      data: { status: "CANCELLED", autoClosedAt: expect.any(Date) },
    });
    expect(tx.visit.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        workOrderId: "wo-1",
        status: "DONE",
        travelFromEndedAt: null,
      },
      data: { travelFromEndedAt: expect.any(Date) },
    });
    expect(tx.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { workOrderId: "wo-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("lar visiter og sporingslenker være i fred ved en ikke-lukket overgang", async () => {
    const tx = makeTx();
    useTx(tx);

    const result = await call("OPEN", "PLANNED");

    expect(result).toEqual({ ok: true });
    expect(tx.visit.updateMany).not.toHaveBeenCalled();
    expect(tx.trackingLink.updateMany).not.toHaveBeenCalled();
  });

  it("følger konfigurerte lukkestatuser, ikke bare COMPLETED/CANCELLED", async () => {
    setWorkOrderStatusConfig({
      WAITING: { category: "CLOSED", sortOrder: 40, isActive: true },
    });
    const tx = makeTx();
    useTx(tx);

    const result = await call("OPEN", "WAITING");

    expect(result).toEqual({ ok: true });
    expect(tx.visit.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        workOrderId: "wo-1",
        status: { in: ["EN_ROUTE", "ON_SITE"] },
        doneAt: null,
      },
      data: { status: "DONE", doneAt: expect.any(Date), autoClosedAt: expect.any(Date) },
    });
    expect(tx.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { workOrderId: "wo-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("lar bare administrator gjenåpne et fullført oppdrag", async () => {
    const vanlig = await call("COMPLETED", "IN_PROGRESS", false);
    expect(vanlig).toEqual({ ok: false, error: "ugyldig-status" });

    const tx = makeTx();
    useTx(tx);

    const admin = await call("COMPLETED", "IN_PROGRESS", true);
    expect(admin).toEqual({ ok: true });
    // Gjenåpning skal ikke tilbakekalle sporingslenker på nytt.
    expect(tx.trackingLink.updateMany).not.toHaveBeenCalled();
    // Bare visiter lukkingen selv markerte skal vurderes.
    expect(tx.visit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workOrderId: "wo-1", autoClosedAt: { not: null } },
      }),
    );
  });

  it("gjenoppretter bare visiter lukkingen selv lukket", async () => {
    const tx = makeTx();
    tx.visit.findMany.mockResolvedValue([
      {
        id: "visit-1",
        status: "DONE",
        enRouteAt: new Date("2026-11-01T07:00:00Z"),
        onSiteAt: new Date("2026-11-01T07:30:00Z"),
        doneAt: new Date("2026-11-01T09:00:00Z"),
        travelFromEndedAt: new Date("2026-11-01T09:20:00Z"),
        technicians: [],
      },
      {
        id: "visit-2",
        status: "CANCELLED",
        enRouteAt: null,
        onSiteAt: null,
        doneAt: null,
        travelFromEndedAt: null,
        technicians: [{ userId: "tech-1" }],
      },
    ]);
    useTx(tx);

    const admin = await call("COMPLETED", "IN_PROGRESS", true);

    expect(admin).toEqual({ ok: true });
    // Uten montør blir visitten planlagt; med montør beholder den tildelingen.
    expect(tx.visit.update).toHaveBeenNthCalledWith(1, {
      where: { id: "visit-1" },
      data: {
        status: "PLANNED",
        autoClosedAt: null,
        enRouteAt: null,
        onSiteAt: null,
        doneAt: null,
        travelFromEndedAt: null,
      },
    });
    expect(tx.visit.update).toHaveBeenNthCalledWith(2, {
      where: { id: "visit-2" },
      data: {
        status: "ASSIGNED",
        autoClosedAt: null,
        enRouteAt: null,
        onSiteAt: null,
        doneAt: null,
        travelFromEndedAt: null,
      },
    });
    // Revisjonssporet skal vise hva som ble gjenopprettet og hva det var.
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          restoredVisits: 2,
          reopenedVisits: expect.arrayContaining([
            expect.objectContaining({ id: "visit-1", previousStatus: "DONE" }),
          ]),
        }),
      }),
    });
  });

  it("oppdaterer bare fra riktig status og logger med oppdragets id", async () => {
    const tx = makeTx();
    useTx(tx);

    const result = await call("OPEN", "PLANNED");

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "wo-1", status: "OPEN" },
      data: { status: "PLANNED" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        // Aldri tittelen – alltid rad-id-en.
        entityId: "wo-1",
        action: "Endret status",
      }),
    });
  });

  it("avviser når statusen er endret av en annen forespørsel", async () => {
    const tx = makeTx();
    tx.workOrder.updateMany.mockResolvedValue({ count: 0 });
    useTx(tx);

    const result = await call("OPEN", "PLANNED");

    expect(result).toEqual({ ok: false, error: "ugyldig-status" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it("ruller tilbake statusen når revisjonsloggen feiler", async () => {
    let committedStatus = "OPEN";

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => {
        let workingStatus = committedStatus;
        const tx = {
          ...makeTx(),
          workOrder: {
            updateMany: vi.fn(async ({ data }: { data: { status: string } }) => {
              workingStatus = data.status;
              return { count: 1 };
            }),
          },
          auditLog: {
            create: vi.fn(async () => {
              throw new Error("audit feilet");
            }),
          },
        };

        try {
          const result = await callback(tx);
          committedStatus = workingStatus;
          return result;
        } catch (error) {
          // Simulerer at databasetransaksjonen rulles tilbake.
          workingStatus = committedStatus;
          throw error;
        }
      },
    );

    await expect(call("OPEN", "PLANNED")).rejects.toThrow("audit feilet");
    expect(committedStatus).toBe("OPEN");
  });

  it("kaster videre og lar være å committe når transaksjonen avvises", async () => {
    mocks.prisma.$transaction.mockRejectedValue(new Error("transaksjon feilet"));

    await expect(call("OPEN", "PLANNED")).rejects.toThrow("transaksjon feilet");
  });
});

describe("schema-typer", () => {
  it("har en transaksjonsklient som inneholder revisjonsloggen", () => {
    // En enkel kompileringstest: audit krever en Prisma.TransactionClient.
    const typeCheck: keyof Prisma.TransactionClient = "auditLog";
    expect(typeCheck).toBe("auditLog");
  });
});
