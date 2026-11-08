import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    pushDevice: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    pushMessage: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    notification: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/modules", () => ({
  moduleEnabled: vi.fn(async () => true),
}));

import {
  clearStalePushDevices,
  enqueuePushForNotification,
  processPendingPushMessages,
  pushPathForNotification,
  registerPushDevice,
  unregisterPushDevice,
} from "./push";
import { pushProviderForPlatform } from "@/lib/push";

const actor: ServiceActor = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-1",
};

const admin: ServiceActor = { ...actor, id: "admin-1", role: "ADMIN" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => unknown)(mocks.prisma);
    },
  );
  mocks.prisma.pushDevice.findUnique.mockResolvedValue(null);
  mocks.prisma.pushDevice.findFirst.mockResolvedValue(null);
  mocks.prisma.pushDevice.findMany.mockResolvedValue([]);
  mocks.prisma.pushDevice.create.mockResolvedValue({
    id: "d1",
    platform: "android",
    appVersion: "1.0.0",
    deviceId: null,
    active: true,
    lastSeenAt: new Date("2026-11-09T09:20:00.000Z"),
    createdAt: new Date("2026-11-09T09:20:00.000Z"),
  });
  mocks.prisma.pushDevice.update.mockResolvedValue({});
  mocks.prisma.pushDevice.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.pushDevice.delete.mockResolvedValue({});
  mocks.prisma.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.pushDevice.count.mockResolvedValue(0);
  mocks.prisma.pushMessage.findMany.mockResolvedValue([]);
  mocks.prisma.pushMessage.findFirst.mockResolvedValue(null);
  mocks.prisma.pushMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.pushMessage.update.mockResolvedValue({});
  mocks.prisma.pushMessage.createMany.mockResolvedValue({ count: 0 });
  mocks.prisma.pushMessage.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.pushMessage.count.mockResolvedValue(0);
  mocks.prisma.user.findUnique.mockResolvedValue({
    isActive: true,
    locale: "nb",
  });
  mocks.audit.mockResolvedValue(undefined);
});

describe("registrering av push-enheter", () => {
  it("avviser ugyldig plattform, kort token og for lang versjon", async () => {
    await expect(
      registerPushDevice(actor, {
        token: "token-12345678",
        platform: "windows",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      registerPushDevice(actor, { token: "kort", platform: "android" }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      registerPushDevice(actor, {
        token: "token-12345678",
        platform: "android",
        appVersion: "1".repeat(41),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.pushDevice.create).not.toHaveBeenCalled();
  });

  it("avviser inaktiv aktør", async () => {
    await expect(
      registerPushDevice(
        { ...actor, isActive: false },
        { token: "token-12345678", platform: "android" },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("re-autentiserer mot databasen og avviser en deaktivert konto", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u1", isActive: false });
    await expect(
      registerPushDevice(actor, {
        token: "token-12345678",
        platform: "android",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.pushDevice.create).not.toHaveBeenCalled();
  });

  it("oppretter en ny enhet uten å lagre tokenet i revisjonsloggen", async () => {
    const result = await registerPushDevice(actor, {
      token: "token-12345678",
      platform: "android",
      appVersion: "1.4.2",
      deviceId: "device-abc",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.pushDevice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        platform: "android",
        token: "token-12345678",
        appVersion: "1.4.2",
        deviceId: "device-abc",
        active: true,
      }),
      select: expect.any(Object),
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(
      "token-12345678",
    );
  });

  it("flytter eierskapet når tokenet allerede finnes på en annen bruker", async () => {
    mocks.prisma.pushDevice.findUnique.mockResolvedValue({
      id: "d1",
      userId: "other-user",
    });

    const result = await registerPushDevice(actor, {
      token: "token-12345678",
      platform: "ios",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.pushDevice.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        userId: "u1",
        active: true,
      }),
    });
    expect(mocks.prisma.pushMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        deviceId: "d1",
        status: { in: ["PENDING", "SENDING"] },
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "PushDevice",
        entityId: "d1",
        metadata: expect.objectContaining({ ownerChanged: true }),
      }),
    );
  });

  it("avregistrerer bare eierens enhet og er idempotent", async () => {
    mocks.prisma.pushDevice.findFirst.mockResolvedValueOnce({ id: "d1" });

    await expect(
      unregisterPushDevice(actor, {
        token: "token-12345678",
        platform: "android",
      }),
    ).resolves.toEqual({ ok: true, data: { removed: true } });
    expect(mocks.prisma.pushDevice.delete).toHaveBeenCalledWith({
      where: { id: "d1" },
    });

    mocks.prisma.pushDevice.findFirst.mockResolvedValueOnce(null);
    await expect(
      unregisterPushDevice(actor, {
        token: "token-12345678",
        platform: "android",
      }),
    ).resolves.toEqual({ ok: true, data: { removed: false } });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(
      "token-12345678",
    );
  });
});

describe("push-utboks", () => {
  it("lager én idempotent rad per aktiv enhet", async () => {
    mocks.prisma.pushDevice.findMany.mockResolvedValue([
      { id: "d1", platform: "android" },
      { id: "d2", platform: "ios" },
    ]);
    mocks.prisma.pushMessage.createMany.mockResolvedValue({ count: 2 });

    const created = await enqueuePushForNotification({
      id: "n1",
      userId: "u1",
      type: "ASSIGNMENT",
    });

    expect(created).toBe(2);
    expect(mocks.prisma.pushMessage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          idempotencyKey: "n1:d1",
          notificationId: "n1",
          deviceId: "d1",
          platform: "android",
        }),
        expect.objectContaining({
          idempotencyKey: "n1:d2",
          notificationId: "n1",
          deviceId: "d2",
          platform: "ios",
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("bygger dype lenker for oppdrag, booking og faktura", () => {
    expect(
      pushPathForNotification("ASSIGNMENT", "/mine-oppdrag/wo1"),
    ).toBe("/oppdrag/wo1");
    expect(pushPathForNotification("BOOKING", "/oppdrag/wo1")).toBe(
      "/bookinger",
    );
    expect(pushPathForNotification("INVOICE_PAID", "/faktura/inv1")).toBe(
      "/faktura/inv1",
    );
    expect(pushPathForNotification("ASSIGNMENT", "https://evil.test")).toBe(
      null,
    );
  });

  it("deaktiverer enheten ved invalid_token", async () => {
    mocks.prisma.pushMessage.findMany
      .mockResolvedValueOnce([
      {
        id: "m1",
        idempotencyKey: "n1:d1",
        notificationId: "n1",
        userId: "u1",
        deviceId: "d1",
        platform: "android",
        title: null,
        body: null,
        path: null,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        errorCode: null,
        lastError: null,
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        device: {
          id: "d1",
          token: "token-12345678",
          platform: "android",
          active: true,
        },
      },
    ])
      .mockResolvedValue([]);
    mocks.prisma.pushMessage.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.notification.findUnique.mockResolvedValue({
      id: "n1",
      type: "ASSIGNMENT",
      title: "Tildelt",
      titleKey: null,
      body: "Et oppdrag",
      bodyKey: null,
      params: null,
      href: "/mine-oppdrag/wo1",
      user: { role: "TECHNICIAN", locale: "nb", isActive: true },
    });

    const result = await processPendingPushMessages(5, {
      providerForPlatform: () => ({
        name: "fcm",
        platform: "android",
        configured: true,
        send: async () => ({
          status: "failed",
          code: "invalid_token",
          retryable: false,
        }),
      }),
    });

    expect(result).toEqual({
      processed: 1,
      sent: 0,
      skipped: 0,
      failed: 1,
    });
    expect(mocks.prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { active: false },
    });
    expect(mocks.prisma.pushMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorCode: "invalid_token",
      }),
    });
  });

  it("er en no-op når leverandøren ikke er konfigurert", async () => {
    const provider = pushProviderForPlatform("android", {});
    await expect(
      provider.send({
        token: "token-12345678",
        title: "Test",
        body: null,
        path: null,
        notificationId: null,
        type: "TEST",
      }),
    ).resolves.toEqual({ status: "skipped", code: "not_configured" });
  });

  it("bare administrator kan rydde foreldede enheter", async () => {
    await expect(clearStalePushDevices(actor)).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    mocks.prisma.pushDevice.deleteMany.mockResolvedValue({ count: 3 });
    await expect(clearStalePushDevices(admin)).resolves.toEqual({
      ok: true,
      data: { deleted: 3 },
    });
  });
});
