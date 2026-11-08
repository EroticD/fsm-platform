import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import {
  commitUploadQuota,
  releaseExpiredUploadQuotaReservations,
  releaseUploadQuota,
  reserveUploadQuota,
  userQuotaBytes,
} from "@/lib/upload-quota";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const ONE_MB = 1024 * 1024;
const SIZE = 300 * 1024;

/**
 * Disse testene muterer en ekte PostgreSQL-database. De bruker unike
 * bruker-/kunde-id-er og rydder både reservasjoner og `Upload`-rader etter seg,
 * slik at de kan kjøres mot den dedikerte testdatabasen.
 */
describeIntegration("atomisk opplastingskvote", () => {
  const userIds: string[] = [];
  const customerIds: string[] = [];
  const storedNames: string[] = [];

  function userId() {
    const id = unique("quota-user");
    userIds.push(id);
    return id;
  }

  function customerId() {
    const id = unique("quota-customer");
    customerIds.push(id);
    return id;
  }

  function storedName() {
    const name = `${unique("quota-file")}.pdf`;
    storedNames.push(name);
    return name;
  }

  beforeAll(() => {
    process.env.UPLOAD_QUOTA_USER_MB = "1";
    process.env.UPLOAD_QUOTA_CUSTOMER_MB = "1";
  });

  afterEach(async () => {
    await prisma.uploadQuotaReservation.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.uploadQuotaReservation.deleteMany({
      where: { customerId: { in: customerIds } },
    });
    await prisma.upload.deleteMany({
      where: { storedName: { in: storedNames } },
    });
    userIds.length = 0;
    customerIds.length = 0;
    storedNames.length = 0;
  });

  afterAll(() => {
    delete process.env.UPLOAD_QUOTA_USER_MB;
    delete process.env.UPLOAD_QUOTA_CUSTOMER_MB;
  });

  it("kan ikke overskride brukerkvoten ved samtidige reservasjoner", async () => {
    const user = userId();
    const customer = customerId();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveUploadQuota({ userId: user, customerId: customer, size: SIZE }),
      ),
    );

    const allowed = results.filter((result) => result.allowed);
    expect(allowed).toHaveLength(3);
    expect(allowed.length * SIZE).toBeLessThanOrEqual(userQuotaBytes());
    for (const denied of results.filter((result) => !result.allowed)) {
      expect(denied).toMatchObject({ allowed: false, scope: "user" });
    }

    const reserved = await prisma.uploadQuotaReservation.aggregate({
      where: { userId: user },
      _sum: { size: true },
    });
    expect(reserved._sum.size ?? 0).toBeLessThanOrEqual(ONE_MB);
  });

  it("kan ikke overskride kundekvoten på tvers av samtidige brukere", async () => {
    const customer = customerId();

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        reserveUploadQuota({
          userId: userId(),
          customerId: customer,
          size: SIZE,
        }),
      ),
    );

    const allowed = results.filter((result) => result.allowed);
    expect(allowed).toHaveLength(3);
    for (const denied of results.filter((result) => !result.allowed)) {
      expect(denied).toMatchObject({ allowed: false, scope: "customer" });
    }
  });

  it("frigjør reservasjonen ved vellykket commit og belaster kvoten med Upload-raden", async () => {
    const user = userId();
    const customer = customerId();
    const reservation = await reserveUploadQuota({
      userId: user,
      customerId: customer,
      size: 400 * 1024,
    });
    expect(reservation.allowed).toBe(true);
    if (!reservation.allowed) throw new Error("reservasjon avvist");

    const name = storedName();
    const committed = await commitUploadQuota({
      reservationId: reservation.reservationId,
      size: 400 * 1024,
      upload: {
        storedName: name,
        originalName: "rapport.pdf",
        mimeType: "application/pdf",
        ownerType: "DOCUMENT",
        uploadedById: user,
        customerId: customer,
      },
    });
    expect(committed).toEqual({ ok: true });

    expect(
      await prisma.uploadQuotaReservation.count({
        where: { id: reservation.reservationId },
      }),
    ).toBe(0);
    const upload = await prisma.upload.findUniqueOrThrow({
      where: { storedName: name },
    });
    expect(upload.size).toBe(400 * 1024);

    // 400 KiB brukt + 300 KiB reservert er innenfor 1 MiB.
    expect(
      await reserveUploadQuota({ userId: user, customerId: customer, size: SIZE }),
    ).toMatchObject({ allowed: true });
    // 400 + 300 + 400 KiB overskrider grensen.
    expect(
      await reserveUploadQuota({
        userId: user,
        customerId: customer,
        size: 400 * 1024,
      }),
    ).toMatchObject({ allowed: false, scope: "user" });
  });

  it("avviser commit over kvoten uten å skrive Upload-rad eller beholde reservasjon", async () => {
    const user = userId();
    const reservation = await reserveUploadQuota({
      userId: user,
      customerId: null,
      size: 100 * 1024,
    });
    if (!reservation.allowed) throw new Error("reservasjon avvist");

    const committed = await commitUploadQuota({
      reservationId: reservation.reservationId,
      size: ONE_MB + 1,
      upload: {
        storedName: storedName(),
        originalName: "stor.pdf",
        mimeType: "application/pdf",
        ownerType: "DOCUMENT",
        uploadedById: user,
      },
    });

    expect(committed).toMatchObject({
      ok: false,
      reason: "quota",
      scope: "user",
    });
    expect(
      await prisma.uploadQuotaReservation.count({
        where: { id: reservation.reservationId },
      }),
    ).toBe(0);
    expect(
      await prisma.upload.count({ where: { uploadedById: user } }),
    ).toBe(0);
  });

  it("frigir plass ved release og ignorerer utløpte reservasjoner", async () => {
    const user = userId();
    const first = await reserveUploadQuota({
      userId: user,
      customerId: null,
      size: 900 * 1024,
    });
    if (!first.allowed) throw new Error("reservasjon avvist");

    await releaseUploadQuota(first.reservationId);
    expect(
      await reserveUploadQuota({
        userId: user,
        customerId: null,
        size: 900 * 1024,
      }),
    ).toMatchObject({ allowed: true });

    // En utløpt rad fra en krasjet prosess skal ikke låse kvoten.
    await prisma.uploadQuotaReservation.deleteMany({ where: { userId: user } });
    await prisma.uploadQuotaReservation.create({
      data: {
        userId: user,
        customerId: null,
        size: 2 * ONE_MB,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(
      await reserveUploadQuota({
        userId: user,
        customerId: null,
        size: 900 * 1024,
      }),
    ).toMatchObject({ allowed: true });

    expect(await releaseExpiredUploadQuotaReservations()).toBeGreaterThanOrEqual(
      1,
    );
  });
});
