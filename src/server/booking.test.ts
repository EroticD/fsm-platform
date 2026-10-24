import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  allowRequestDb: vi.fn(),
  getDefaultDepartmentId: vi.fn(),
  notifyWorkOrderEvent: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/lib/departments", () => ({
  getDefaultDepartmentId: mocks.getDefaultDepartmentId,
}));
vi.mock("./notifications", () => ({
  notifyWorkOrderEvent: mocks.notifyWorkOrderEvent,
  notifyUser: mocks.notifyUser,
}));

import { createBooking } from "./portal";

const customer = (overrides: Partial<ServiceActor> = {}): ServiceActor => ({
  id: "u1",
  name: "Kunde",
  email: "kunde@example.test",
  role: "CUSTOMER",
  isActive: true,
  departmentId: null,
  customerId: "cust-1",
  contactId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
  ...overrides,
});

const booking = {
  title: "Årlig service",
  description: "Trenger service på anlegget.",
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.workOrder.findFirst.mockResolvedValue(null);
  mocks.prisma.workOrder.count.mockResolvedValue(0);
  mocks.prisma.workOrder.create.mockResolvedValue({ id: "wo-1" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.getDefaultDepartmentId.mockResolvedValue("dep-1");
  mocks.notifyWorkOrderEvent.mockResolvedValue(1);
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});

describe("createBooking", () => {
  it("avviser andre enn en innlogget kunde", async () => {
    await expect(
      createBooking(customer({ role: "OFFICE", customerId: null }), booking),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(
      createBooking(customer({ isActive: false }), booking),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });

    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
  });

  it("avviser den sjette bestillingen innenfor en time", async () => {
    let customerAttempts = 0;
    mocks.allowRequestDb.mockImplementation(async (key: string) => {
      if (key === "booking:customer:cust-1") {
        customerAttempts += 1;
        return {
          allowed: customerAttempts <= 5,
          retryAfterSeconds: customerAttempts <= 5 ? 0 : 3600,
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      mocks.prisma.workOrder.create.mockResolvedValueOnce({
        id: `wo-${attempt}`,
      });
      await expect(
        createBooking(customer(), {
          ...booking,
          title: `Bestilling ${attempt}`,
          ip: "10.0.0.1",
        }),
      ).resolves.toEqual({ ok: true, data: { id: `wo-${attempt}` } });
    }

    const sixth = await createBooking(customer(), {
      ...booking,
      title: "Bestilling 6",
      ip: "10.0.0.1",
    });

    expect(sixth).toEqual({ ok: false, reason: "rate_limited" });
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledTimes(5);
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledTimes(5);
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "booking:customer:cust-1",
      5,
      60 * 60_000,
    );
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "booking:ip:10.0.0.1",
      10,
      60 * 60_000,
    );
  });

  it("avviser når IP-grensen er brukt opp", async () => {
    mocks.allowRequestDb.mockImplementation(async (key: string) =>
      key.startsWith("booking:ip:")
        ? { allowed: false, retryAfterSeconds: 120 }
        : { allowed: true, retryAfterSeconds: 0 },
    );

    const result = await createBooking(customer(), {
      ...booking,
      ip: "10.0.0.9",
    });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("avviser når kunden har fem åpne bestillinger fra før", async () => {
    mocks.prisma.workOrder.count.mockResolvedValue(5);

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mocks.prisma.workOrder.count).toHaveBeenCalledWith({
      where: { customerId: "cust-1", status: "OPEN", deletedAt: null },
    });
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("returnerer eksisterende sak for lik bestilling og varsler ikke på nytt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({ id: "wo-existing" });

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({
      ok: true,
      data: { id: "wo-existing", duplicate: true },
    });
    expect(mocks.prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: "cust-1",
          title: booking.title,
          description: booking.description,
          deletedAt: null,
        }),
      }),
    );
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("oppretter oppdrag og revisjonslogg i samme transaksjon", async () => {
    const result = await createBooking(customer(), {
      ...booking,
      ip: "10.0.0.2",
    });

    expect(result).toEqual({ ok: true, data: { id: "wo-1" } });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: booking.title,
        description: booking.description,
        departmentId: "dep-1",
        customerId: "cust-1",
        status: "OPEN",
        creatorName: "Kunde",
      }),
      select: { id: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-1",
      }),
    );
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledWith(
      "wo-1",
      "BOOKING",
      expect.any(String),
      expect.any(String),
      "/oppdrag/wo-1",
      "booking:wo-1",
    );
  });

  it("ruller tilbake begge skrivingene når revisjonsloggen feiler", async () => {
    mocks.audit.mockRejectedValue(new Error("audit feilet"));

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({ ok: false, reason: "error" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("bruker alltid aktørens egen customerId", async () => {
    const result = await createBooking(customer(), {
      ...booking,
      // Ondsinnet klient kan sende et ekstra felt; det skal ignoreres.
      customerId: "cust-2",
    } as typeof booking & { customerId: string });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: "cust-1" }),
      }),
    );
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "cust-1" }),
      }),
    );
  });
});
