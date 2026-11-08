import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadAggregate: vi.fn(),
  uploadCreate: vi.fn(),
  reservationAggregate: vi.fn(),
  reservationCreate: vi.fn(),
  reservationDelete: vi.fn(),
  reservationDeleteMany: vi.fn(),
  reservationFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    upload: {
      aggregate: mocks.uploadAggregate,
      create: mocks.uploadCreate,
    },
    uploadQuotaReservation: {
      aggregate: mocks.reservationAggregate,
      create: mocks.reservationCreate,
      delete: mocks.reservationDelete,
      deleteMany: mocks.reservationDeleteMany,
      findUnique: mocks.reservationFindUnique,
    },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

import {
  checkUploadQuota,
  commitUploadQuota,
  customerQuotaBytes,
  releaseExpiredUploadQuotaReservations,
  releaseUploadQuota,
  reserveUploadQuota,
  userQuotaBytes,
} from "./upload-quota";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadAggregate.mockResolvedValue({ _sum: { size: 0 } });
  mocks.reservationAggregate.mockResolvedValue({ _sum: { size: 0 } });
  mocks.reservationCreate.mockResolvedValue({ id: "reservation-1" });
  mocks.reservationDelete.mockResolvedValue({ id: "reservation-1" });
  mocks.reservationDeleteMany.mockResolvedValue({ count: 1 });
  mocks.queryRaw.mockResolvedValue([]);
  mocks.uploadCreate.mockResolvedValue({ id: "upload-1" });
  mocks.transaction.mockImplementation(
    async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ) =>
      callback({
        upload: {
          aggregate: mocks.uploadAggregate,
          create: mocks.uploadCreate,
        },
        uploadQuotaReservation: {
          aggregate: mocks.reservationAggregate,
          create: mocks.reservationCreate,
          delete: mocks.reservationDelete,
          deleteMany: mocks.reservationDeleteMany,
          findUnique: mocks.reservationFindUnique,
        },
        $queryRaw: mocks.queryRaw,
      }),
  );
});

afterEach(() => {
  delete process.env.UPLOAD_QUOTA_USER_MB;
  delete process.env.UPLOAD_QUOTA_CUSTOMER_MB;
});

describe("kvotekonfigurasjon", () => {
  it("bruker 2 GiB og 10 GiB når miljøvariablene mangler", () => {
    expect(userQuotaBytes()).toBe(2 * 1024 * 1024 * 1024);
    expect(customerQuotaBytes()).toBe(10 * 1024 * 1024 * 1024);
  });
});

describe("checkUploadQuota", () => {
  it("tillater en vanlig opplasting på noen megabyte med standardkvotene", async () => {
    await expect(
      checkUploadQuota({
        userId: "u1",
        customerId: "c1",
        size: 5 * 1024 * 1024,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it("tillater opplasting innenfor begge kvotene", async () => {
    await expect(
      checkUploadQuota({ userId: "u1", customerId: "c1", size: 1024 }),
    ).resolves.toEqual({ allowed: true });
    expect(mocks.uploadAggregate).toHaveBeenCalledTimes(2);
  });

  it("avviser når brukerens 24-timerskvote overskrides", async () => {
    process.env.UPLOAD_QUOTA_USER_MB = "1";
    mocks.uploadAggregate.mockResolvedValueOnce({
      _sum: { size: userQuotaBytes() },
    });

    const result = await checkUploadQuota({
      userId: "u1",
      customerId: null,
      size: 1,
    });

    expect(result).toMatchObject({
      allowed: false,
      scope: "user",
      limitBytes: userQuotaBytes(),
    });
  });

  it("avviser når kundens samlede kvote overskrides", async () => {
    process.env.UPLOAD_QUOTA_CUSTOMER_MB = "1";
    mocks.uploadAggregate
      .mockResolvedValueOnce({ _sum: { size: 0 } })
      .mockResolvedValueOnce({ _sum: { size: customerQuotaBytes() } });

    const result = await checkUploadQuota({
      userId: "u1",
      customerId: "c1",
      size: 1,
    });

    expect(result).toMatchObject({
      allowed: false,
      scope: "customer",
      limitBytes: customerQuotaBytes(),
    });
  });
});

describe("reserveUploadQuota", () => {
  it("oppretter en reservasjon når begge kvotene har plass", async () => {
    const result = await reserveUploadQuota({
      userId: "u1",
      customerId: "c1",
      size: 1024,
    });

    expect(result).toMatchObject({
      allowed: true,
      reservationId: "reservation-1",
      reservedBytes: 1024,
    });
    expect(mocks.reservationCreate).toHaveBeenCalledTimes(1);
    // Bruker- og kundelåsen tas i deterministisk rekkefølge.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("avviser uten å opprette reservasjon når brukerkvoten er full", async () => {
    process.env.UPLOAD_QUOTA_USER_MB = "1";
    mocks.uploadAggregate.mockResolvedValueOnce({
      _sum: { size: userQuotaBytes() },
    });

    const result = await reserveUploadQuota({
      userId: "u1",
      customerId: null,
      size: 1,
    });

    expect(result).toMatchObject({
      allowed: false,
      scope: "user",
      limitBytes: userQuotaBytes(),
    });
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
  });

  it("teller aktive reservasjoner mot kundekvoten", async () => {
    process.env.UPLOAD_QUOTA_CUSTOMER_MB = "1";
    mocks.reservationAggregate
      .mockResolvedValueOnce({ _sum: { size: 0 } })
      .mockResolvedValueOnce({ _sum: { size: customerQuotaBytes() } });

    const result = await reserveUploadQuota({
      userId: "u1",
      customerId: "c1",
      size: 1,
    });

    expect(result).toMatchObject({
      allowed: false,
      scope: "customer",
      limitBytes: customerQuotaBytes(),
    });
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
  });

  it("ignorerer utløpte reservasjoner", async () => {
    await reserveUploadQuota({
      userId: "u1",
      customerId: null,
      size: 1024,
    });

    expect(mocks.reservationAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u1",
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
  });
});

describe("commitUploadQuota", () => {
  function reservation(overrides: Record<string, unknown> = {}) {
    return {
      id: "reservation-1",
      userId: "u1",
      customerId: "c1",
      size: 1024,
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  it("skriver Upload-raden og sletter reservasjonen i samme transaksjon", async () => {
    mocks.reservationFindUnique.mockResolvedValue(reservation());

    const result = await commitUploadQuota({
      reservationId: "reservation-1",
      size: 900,
      upload: {
        storedName: "fil.pdf",
        originalName: "fil.pdf",
        mimeType: "application/pdf",
        ownerType: "DOCUMENT",
      },
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.uploadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ size: 900, storedName: "fil.pdf" }),
      }),
    );
    expect(mocks.reservationDelete).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
    });
  });

  it("avviser når faktisk størrelse overskrider kvoten og frigjør reservasjonen", async () => {
    process.env.UPLOAD_QUOTA_USER_MB = "1";
    mocks.reservationFindUnique.mockResolvedValue(reservation());
    mocks.uploadAggregate.mockResolvedValueOnce({
      _sum: { size: userQuotaBytes() },
    });

    const result = await commitUploadQuota({
      reservationId: "reservation-1",
      size: 2 * 1024 * 1024,
      upload: {
        storedName: "fil.pdf",
        originalName: "fil.pdf",
        mimeType: "application/pdf",
        ownerType: "DOCUMENT",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "quota",
      scope: "user",
    });
    expect(mocks.uploadCreate).not.toHaveBeenCalled();
    expect(mocks.reservationDelete).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
    });
  });

  it("avviser uten å skrive når reservasjonen er utløpt", async () => {
    mocks.reservationFindUnique.mockResolvedValue(
      reservation({ expiresAt: new Date(Date.now() - 1) }),
    );

    const result = await commitUploadQuota({
      reservationId: "reservation-1",
      size: 1024,
      upload: {
        storedName: "fil.pdf",
        originalName: "fil.pdf",
        mimeType: "application/pdf",
        ownerType: "DOCUMENT",
      },
    });

    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(mocks.uploadCreate).not.toHaveBeenCalled();
  });
});

describe("opprydding av reservasjoner", () => {
  it("frigjør en reservasjon idempotent", async () => {
    await releaseUploadQuota("reservation-1");
    expect(mocks.reservationDeleteMany).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
    });
  });

  it("sletter bare utløpte reservasjoner", async () => {
    await expect(releaseExpiredUploadQuotaReservations()).resolves.toBe(1);
    expect(mocks.reservationDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
    });
  });
});
