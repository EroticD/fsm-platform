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

  it("lager ikke ulest varsel når bare e-post er slått på", async () => {
    mocks.prisma.notificationPreference.findUnique.mockResolvedValue({
      inApp: false,
      email: true,
    });

    await notifyUser({
      userId: "u1",
      type: "ASSIGNMENT",
      title: "Nytt oppdrag",
      dedupeKey: "assign:wo1:u1",
    });

    expect(mocks.prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        readAt: expect.any(Date),
        emailSentAt: null,
      }),
      select: { id: true },
    });
  });

  it("lar in-app-varsel være ulest når in-app er slått på", async () => {
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
      data: expect.objectContaining({
        readAt: null,
        emailSentAt: expect.any(Date),
      }),
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
        emailAttempts: 0,
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
      data: {
        emailSentAt: expect.any(Date),
        emailAttempts: 1,
        emailError: null,
        emailLockedAt: null,
        emailLockedBy: null,
      },
    });
  });

  it("sender kundeportalbrukere til portalen i e-postlenken", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n2",
        type: "REPORT_READY",
        title: "Rapport klar",
        body: "En signert rapport er klar.",
        href: "/mine-oppdrag/wo1",
        emailAttempts: 0,
        user: { email: "kunde@example.test", role: "CUSTOMER" },
      },
    ]);

    const result = await processPendingNotificationEmails();

    expect(result).toEqual({ processed: 1, sent: 1 });
    expect(mocks.sendNotificationEmail).toHaveBeenCalledWith(
      "kunde@example.test",
      "Rapport klar",
      "En signert rapport er klar.",
      "/kundeportal#rapporter",
    );
  });

  it("prøver på nytt med backoff når e-post feiler", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Nytt oppdrag",
        body: "Se oppdraget",
        href: null,
        emailAttempts: 0,
        user: { email: "kari@example.test" },
      },
    ]);
    mocks.sendNotificationEmail.mockRejectedValue(new Error("SMTP nede"));

    const result = await processPendingNotificationEmails();

    expect(result).toEqual({ processed: 1, sent: 0 });
    expect(mocks.prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: {
        emailAttempts: 1,
        emailNextAttemptAt: expect.any(Date),
        emailError: "SMTP nede",
        emailLockedAt: null,
        emailLockedBy: null,
      },
    });

    const update = mocks.prisma.notification.update.mock.calls[0][0] as {
      data: { emailNextAttemptAt: Date };
    };
    const delayMs = update.data.emailNextAttemptAt.getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(5 * 60_000);
    expect(delayMs).toBeLessThanOrEqual(60 * 60_000 + 1_000);
  });

  it("gir opp etter fem forsøk", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Nytt oppdrag",
        body: "Se oppdraget",
        href: null,
        emailAttempts: 4,
        user: { email: "kari@example.test" },
      },
    ]);
    mocks.sendNotificationEmail.mockRejectedValue(new Error("SMTP nede"));

    await processPendingNotificationEmails();

    expect(mocks.prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: {
        emailAttempts: 5,
        emailNextAttemptAt: expect.any(Date),
        emailError: "Gave up",
        emailLockedAt: null,
        emailLockedBy: null,
      },
    });
  });

  it("sender bare én gang når to kall kjører samtidig", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Nytt oppdrag",
        body: "Se oppdraget",
        href: null,
        emailAttempts: 0,
        user: { email: "kari@example.test" },
      },
    ]);
    // Første kall holder på låsen mens det andre starter.
    let releaseSend: (value: boolean) => void = () => {};
    mocks.sendNotificationEmail.mockImplementation(
      () => new Promise<boolean>((resolve) => (releaseSend = resolve)),
    );

    const first = processPendingNotificationEmails();
    // Vent til første kall faktisk står i sendingen, og start deretter det andre.
    await vi.waitFor(() =>
      expect(mocks.sendNotificationEmail).toHaveBeenCalledTimes(1),
    );
    const second = processPendingNotificationEmails();
    releaseSend(true);
    const [a, b] = await Promise.all([first, second]);

    expect(mocks.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.processed + b.processed).toBe(1);
  });

  it("tar over en utløpt lease", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Nytt oppdrag",
        body: "Se oppdraget",
        href: null,
        emailAttempts: 0,
        user: { email: "kari@example.test" },
      },
    ]);

    const result = await processPendingNotificationEmails();

    expect(result).toEqual({ processed: 1, sent: 1 });
    const findArgs = mocks.prisma.notification.findMany.mock.calls[0][0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(findArgs.where.OR).toEqual([
      { emailLockedAt: null },
      { emailLockedAt: { lt: expect.any(Date) } },
    ]);

    const claimArgs = mocks.prisma.notification.updateMany.mock.calls[0][0] as {
      where: { id: string; emailSentAt: null; OR: unknown };
      data: { emailLockedAt: Date; emailLockedBy: string };
    };
    expect(claimArgs.where).toEqual({
      id: "n1",
      emailSentAt: null,
      OR: [
        { emailLockedAt: null },
        { emailLockedAt: { lt: expect.any(Date) } },
      ],
    });
    expect(claimArgs.data.emailLockedBy).toContain(String(process.pid));
    expect(claimArgs.data.emailLockedAt).toBeInstanceOf(Date);
    expect(mocks.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("sender ikke når en annen instans vant claimet", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Nytt oppdrag",
        body: "Se oppdraget",
        href: null,
        emailAttempts: 0,
        user: { email: "kari@example.test" },
      },
    ]);
    mocks.prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const result = await processPendingNotificationEmails();

    expect(result).toEqual({ processed: 1, sent: 0 });
    expect(mocks.sendNotificationEmail).not.toHaveBeenCalled();
    expect(mocks.prisma.notification.update).not.toHaveBeenCalled();
  });

  it("frigjør låsen og backer av når sending feiler", async () => {
    mocks.prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Nytt oppdrag",
        body: "Se oppdraget",
        href: null,
        emailAttempts: 0,
        user: { email: "kari@example.test" },
      },
    ]);
    mocks.sendNotificationEmail.mockRejectedValue(new Error("SMTP nede"));

    await processPendingNotificationEmails();

    expect(mocks.prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: expect.objectContaining({
        emailAttempts: 1,
        emailError: "SMTP nede",
        emailLockedAt: null,
        emailLockedBy: null,
      }),
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
    // Inaktive montører skal aldri varsles, selv om de står på oppdraget.
    expect(mocks.prisma.workOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          technicians: { where: { isActive: true }, select: { id: true } },
        }),
      }),
    );
  });
});
