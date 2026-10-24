import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    user: { findMany: vi.fn() },
    workOrder: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/email", () => ({
  sendNotificationEmail: mocks.sendNotificationEmail,
}));

import {
  listNotifications,
  markNotificationRead,
  notifyUser,
  notifyWorkOrderEvent,
  processPendingNotificationEmails,
} from "./notifications";

const actor: ServiceActor = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-a",
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(mocks.prisma),
  );
  mocks.prisma.notification.findMany.mockResolvedValue([]);
  mocks.prisma.notification.count.mockResolvedValue(0);
  mocks.prisma.notification.create.mockResolvedValue({ id: "n1" });
  mocks.prisma.notification.update.mockResolvedValue({});
  mocks.prisma.notification.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.notificationPreference.findUnique.mockResolvedValue(null);
  mocks.prisma.notificationPreference.findMany.mockResolvedValue([]);
  mocks.prisma.notificationPreference.upsert.mockResolvedValue({});
  mocks.prisma.user.findMany.mockResolvedValue([]);
  mocks.sendNotificationEmail.mockResolvedValue(true);
});

describe("varseltjenesten", () => {
  it("lager in-app-varsel og e-postko når preferansen er på", async () => {
    const result = await notifyUser({
      userId: "u1",
      type: "ASSIGNMENT",
      title: "Nytt oppdrag",
      href: "/oppdrag/wo1",
      dedupeKey: "assign:wo1:u1",
    });

    expect(result).toEqual({ id: "n1" });
    expect(mocks.prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        emailSentAt: null,
        dedupeKey: "assign:wo1:u1",
      }),
      select: { id: true },
    });
  });

  it("hopper over e-post når brukeren har slått den av", async () => {
    mocks.prisma.notificationPreference.findUnique.mockResolvedValue({
      inApp: true,
      email: false,
    });

    await notifyUser({
      userId: "u1",
      type: "ASSIGNMENT",
      title: "Nytt oppdrag",
    });

    expect(mocks.prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ emailSentAt: expect.any(Date) }),
      select: { id: true },
    });
  });

  it("lager ingenting når både in-app og e-post er av", async () => {
    mocks.prisma.notificationPreference.findUnique.mockResolvedValue({
      inApp: false,
      email: false,
    });

    const result = await notifyUser({
      userId: "u1",
      type: "ASSIGNMENT",
      title: "Nytt oppdrag",
    });

    expect(result).toBeNull();
    expect(mocks.prisma.notification.create).not.toHaveBeenCalled();
  });

  it("sender ventende e-post og markerer varselet", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Nytt oppdrag",
        body: "Se oppdraget",
        href: "/oppdrag/wo1",
        user: { email: "kari@example.test" },
      },
    ]);

    const result = await processPendingNotificationEmails();

    expect(result).toEqual({ processed: 1, sent: 1 });
    expect(mocks.sendNotificationEmail).toHaveBeenCalledWith(
      "kari@example.test",
      "Nytt oppdrag",
      "Se oppdraget",
      "/oppdrag/wo1",
    );
    expect(mocks.prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { emailSentAt: expect.any(Date), emailError: null },
    });
  });

  it("markerer varselet som lest bare for eieren", async () => {
    await markNotificationRead(actor, "n1");
    expect(mocks.prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "u1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("returnerer not_found når varselet ikke finnes", async () => {
    mocks.prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const result = await markNotificationRead(actor, "n1");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("lister varsler med side og uleste", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([{ id: "n1" }]);
    mocks.prisma.notification.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const result = await listNotifications(actor, { page: 1 });
    expect(result).toEqual({
      ok: true,
      data: {
        items: [{ id: "n1" }],
        total: 1,
        unread: 1,
        page: 1,
        totalPages: 1,
      },
    });
  });

  it("varsler teknikere og kontoret på en oppdragshendelse", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo1",
      departmentId: "dep-a",
      customerId: null,
      technicians: [{ id: "tech1" }],
    });
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "office1" }]);

    const count = await notifyWorkOrderEvent(
      "wo1",
      "BOOKING",
      "Ny booking",
      "Kunden har booket",
      "/oppdrag/wo1",
      "booking:wo1",
    );

    expect(count).toBe(2);
    expect(mocks.prisma.notification.create).toHaveBeenCalledTimes(2);
  });
});
