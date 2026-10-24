import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import { transitionWorkOrderStatus } from "./work-order-status-action";

const actor = { id: "u1", name: "Kari", email: "kari@example.com" };

function call(
  from: "OPEN" | "COMPLETED" | "PLANNED" | "IN_PROGRESS",
  to: "OPEN" | "COMPLETED" | "PLANNED" | "IN_PROGRESS",
  isAdmin = false,
) {
  return transitionWorkOrderStatus({
    workOrderId: "wo-1",
    from,
    to,
    isAdmin,
    actor,
    action: "Endret status",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("transitionWorkOrderStatus", () => {
  it("avviser en ulovlig overgang uten å skrive til databasen", async () => {
    const result = await call("OPEN", "COMPLETED");

    expect(result).toEqual({ ok: false, error: "ugyldig-status" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lar bare administrator gjenåpne et fullført oppdrag", async () => {
    const vanlig = await call("COMPLETED", "IN_PROGRESS", false);
    expect(vanlig).toEqual({ ok: false, error: "ugyldig-status" });

    const tx = {
      workOrder: { updateMany: vi.fn(async () => ({ count: 1 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );

    const admin = await call("COMPLETED", "IN_PROGRESS", true);
    expect(admin).toEqual({ ok: true });
  });

  it("oppdaterer bare fra riktig status og logger med oppdragets id", async () => {
    const tx = {
      workOrder: { updateMany: vi.fn(async () => ({ count: 1 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );

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
    const tx = {
      workOrder: { updateMany: vi.fn(async () => ({ count: 0 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );

    const result = await call("OPEN", "PLANNED");

    expect(result).toEqual({ ok: false, error: "ugyldig-status" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("ruller tilbake statusen når revisjonsloggen feiler", async () => {
    let committedStatus = "OPEN";

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => {
        let workingStatus = committedStatus;
        const tx = {
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
