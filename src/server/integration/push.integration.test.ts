import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import {
  enqueuePushForNotification,
  processPendingPushMessages,
  registerPushDevice,
  unregisterPushDevice,
} from "@/server/push";
import type { ServiceActor } from "@/server/actor";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actorFor(user: {
  id: string;
  name: string | null;
  email: string | null;
}): ServiceActor {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: "TECHNICIAN",
    isActive: true,
    departmentId: null,
  };
}

describeIntegration("Push: enheter og utboks mot PostgreSQL", () => {
  let departmentId = "";
  let owner: Awaited<ReturnType<typeof prisma.user.create>>;
  let other: Awaited<ReturnType<typeof prisma.user.create>>;

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-push-avd") },
    });
    departmentId = department.id;

    owner = await prisma.user.create({
      data: {
        name: unique("push-owner"),
        email: `${unique("push-owner")}@example.test`,
        role: "TECHNICIAN",
        isActive: true,
        departmentId,
      },
    });
    other = await prisma.user.create({
      data: {
        name: unique("push-other"),
        email: `${unique("push-other")}@example.test`,
        role: "TECHNICIAN",
        isActive: true,
        departmentId,
      },
    });
  });

  afterAll(async () => {
    await prisma.pushDevice.deleteMany({
      where: { userId: { in: [owner.id, other.id] } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: [owner.id, other.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, other.id] } },
    });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("upserter token per plattform og flytter eierskap ved ny innlogging", async () => {
    const token = unique("fcm-token").replace(/[^A-Za-z0-9._:\-]/g, "-");

    const first = await registerPushDevice(actorFor(owner), {
      token,
      platform: "android",
      appVersion: "1.0.0",
      deviceId: "device-1",
    });
    expect(first.ok).toBe(true);

    const second = await registerPushDevice(actorFor(owner), {
      token,
      platform: "android",
      appVersion: "1.1.0",
    });
    expect(second.ok).toBe(true);

    const rows = await prisma.pushDevice.findMany({
      where: { platform: "android", token },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(owner.id);
    expect(rows[0].appVersion).toBe("1.1.0");

    const moved = await registerPushDevice(actorFor(other), {
      token,
      platform: "android",
      appVersion: "2.0.0",
    });
    expect(moved.ok).toBe(true);

    const afterMove = await prisma.pushDevice.findUnique({
      where: { platform_token: { platform: "android", token } },
    });
    expect(afterMove?.userId).toBe(other.id);
    expect(afterMove?.appVersion).toBe("2.0.0");
    expect(afterMove?.active).toBe(true);
  });

  it("sletter ventende push når tokenet flyttes til en annen bruker", async () => {
    const token = unique("move-token").replace(/[^A-Za-z0-9._:\-]/g, "-");

    await registerPushDevice(actorFor(owner), {
      token,
      platform: "android",
    });
    const notification = await prisma.notification.create({
      data: {
        userId: owner.id,
        type: "ASSIGNMENT",
        title: "Skal ikke lekke",
        body: "Gammel konto",
        href: "/oppdrag/wo-old",
      },
      select: { id: true },
    });
    await expect(
      enqueuePushForNotification({
        id: notification.id,
        userId: owner.id,
        type: "ASSIGNMENT",
      }),
    ).resolves.toBe(1);

    const device = await prisma.pushDevice.findUniqueOrThrow({
      where: { platform_token: { platform: "android", token } },
      select: { id: true },
    });
    await registerPushDevice(actorFor(other), {
      token,
      platform: "android",
    });

    await expect(
      prisma.pushMessage.count({
        where: { deviceId: device.id, status: { in: ["PENDING", "SENDING"] } },
      }),
    ).resolves.toBe(0);
  });

  it("avregistrerer bare eierens enhet", async () => {
    const token = unique("apns-token").replace(/[^A-Za-z0-9._:\-]/g, "-");

    await registerPushDevice(actorFor(owner), {
      token,
      platform: "ios",
      appVersion: "1.0.0",
    });

    await expect(
      unregisterPushDevice(actorFor(other), { token, platform: "ios" }),
    ).resolves.toEqual({ ok: true, data: { removed: false } });

    await expect(
      unregisterPushDevice(actorFor(owner), { token, platform: "ios" }),
    ).resolves.toEqual({ ok: true, data: { removed: true } });

    await expect(
      prisma.pushDevice.count({
        where: { platform: "ios", token },
      }),
    ).resolves.toBe(0);
  });

  it("køer idempotent og sender hver melding nøyaktig én gang", async () => {
    const token = unique("worker-token").replace(/[^A-Za-z0-9._:\-]/g, "-");

    await registerPushDevice(actorFor(owner), {
      token,
      platform: "android",
      appVersion: "3.0.0",
    });

    const notification = await prisma.notification.create({
      data: {
        userId: owner.id,
        type: "ASSIGNMENT",
        title: "Tildelt oppdrag",
        body: "Et oppdrag er tildelt deg.",
        href: `/mine-oppdrag/${unique("wo")}`,
      },
      select: { id: true },
    });

    await expect(
      enqueuePushForNotification({
        id: notification.id,
        userId: owner.id,
        type: "ASSIGNMENT",
      }),
    ).resolves.toBe(1);
    await expect(
      enqueuePushForNotification({
        id: notification.id,
        userId: owner.id,
        type: "ASSIGNMENT",
      }),
    ).resolves.toBe(0);

    let sends = 0;
    const provider = () => ({
      name: "fcm" as const,
      platform: "android" as const,
      configured: true,
      send: async () => {
        sends += 1;
        return { status: "sent" as const, providerId: "test-message" };
      },
    });

    await expect(
      processPendingPushMessages(10, { providerForPlatform: provider }),
    ).resolves.toEqual({
      processed: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    await expect(
      processPendingPushMessages(10, { providerForPlatform: provider }),
    ).resolves.toEqual({
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(sends).toBe(1);

    const row = await prisma.pushMessage.findUnique({
      where: {
        idempotencyKey: `${notification.id}:${(
          await prisma.pushDevice.findUniqueOrThrow({
            where: { platform_token: { platform: "android", token } },
            select: { id: true },
          })
        ).id}`,
      },
      select: { status: true, attempts: true },
    });
    expect(row?.status).toBe("SENT");
    expect(row?.attempts).toBe(1);
  });
});
