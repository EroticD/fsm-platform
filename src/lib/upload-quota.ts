import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/** Standard døgnkvote per bruker (2 GiB), overstyrbar i miljøet. */
export const DEFAULT_USER_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
/** Standard total kvote per kunde (10 GiB), overstyrbar i miljøet. */
export const DEFAULT_CUSTOMER_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

/** Hvor lenge en reservasjon holder plass før den regnes som forlatt. */
export const UPLOAD_QUOTA_RESERVATION_TTL_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Miljøvariabelen er i megabyte, mens kvotekontrollen regner i bytes.
 * `fallback` er derfor allerede i bytes. Standardverdiene må ikke deles på
 * 1024 × 1024 her: da ville de blitt tolket som noen få kilobyte, og nesten
 * alle ekte opplastinger blitt avvist med 507.
 */
function quotaFromEnv(name: string, fallbackBytes: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0
    ? value * 1024 * 1024
    : fallbackBytes;
}

export function userQuotaBytes(): number {
  return quotaFromEnv("UPLOAD_QUOTA_USER_MB", DEFAULT_USER_QUOTA_BYTES);
}

export function customerQuotaBytes(): number {
  return quotaFromEnv("UPLOAD_QUOTA_CUSTOMER_MB", DEFAULT_CUSTOMER_QUOTA_BYTES);
}

export type UploadQuotaResult =
  | { allowed: true }
  | {
      allowed: false;
      scope: "user" | "customer";
      usedBytes: number;
      limitBytes: number;
    };

export type UploadQuotaReservationResult =
  | {
      allowed: true;
      /** Slettes ved commit eller release; aldri lagret på `Upload`. */
      reservationId: string;
      reservedBytes: number;
      expiresAt: Date;
    }
  | {
      allowed: false;
      scope: "user" | "customer";
      usedBytes: number;
      limitBytes: number;
    };

export type UploadQuotaCommitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "quota";
      scope: "user" | "customer";
      usedBytes: number;
      limitBytes: number;
    }
  | { ok: false; reason: "missing" };

type QuotaSubject = {
  userId: string;
  customerId: string | null;
};

/**
 * Serielåser kvotesubjektene i en deterministisk rekkefølge.
 *
 * Reservasjon og commit leser `Upload` + `UploadQuotaReservation` og skriver en
 * ny rad. Uten en lås kan to samtidige transaksjoner begge se ledig plass og
 * til sammen overskride kvoten. En transaksjonslåst advisory lock gir samme
 * gjensidige utelukkelse som en radlås, uten å låse `User`/`Customer`-radene
 * som resten av appen oppdaterer. Sorteringen hindrer deadlock når både
 * bruker- og kundekvoten skal låses.
 */
async function lockQuotaSubjects(
  tx: Prisma.TransactionClient,
  subject: QuotaSubject,
) {
  const keys = [`user:${subject.userId}`];
  if (subject.customerId) keys.push(`customer:${subject.customerId}`);
  keys.sort();
  for (const key of keys) {
    // `pg_advisory_xact_lock` returnerer `void`; cast til text så Prisma kan
    // deserialisere resultatet.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
  }
}

async function sumUploads(
  tx: Prisma.TransactionClient,
  where: Prisma.UploadWhereInput,
): Promise<number> {
  const result = await tx.upload.aggregate({
    where,
    _sum: { size: true },
  });
  return result._sum.size ?? 0;
}

async function sumActiveReservations(
  tx: Prisma.TransactionClient,
  where: Prisma.UploadQuotaReservationWhereInput,
  now: Date,
): Promise<number> {
  const result = await tx.uploadQuotaReservation.aggregate({
    where: { ...where, expiresAt: { gt: now } },
    _sum: { size: true },
  });
  return result._sum.size ?? 0;
}

function normaliseSize(size: number): number {
  return Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
}

/**
 * Reserverer plass for én opplasting før filen flyttes til endelig mappe.
 *
 * Brukerkvoten er rullerende 24 timer; kunderkvoten er samlet lagringsbruk.
 * Både ferdige `Upload`-rader og andre aktive reservasjoner telles. Låsen gjør
 * kontroll og innsetting atomisk, slik at samtidige opplastinger ikke kan
 * passere grensen sammen. Reservasjonen må alltid avsluttes med
 * `commitUploadQuota` eller `releaseUploadQuota`; utløpte rader ignoreres og
 * ryddes av cronjobben.
 */
export async function reserveUploadQuota(input: {
  userId: string;
  customerId: string | null;
  size: number;
  now?: Date;
}): Promise<UploadQuotaReservationResult> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS);
  const size = normaliseSize(input.size);
  const userLimit = userQuotaBytes();
  const customerLimit = customerQuotaBytes();

  return prisma.$transaction(async (tx) => {
    await lockQuotaSubjects(tx, {
      userId: input.userId,
      customerId: input.customerId,
    });

    const userTotal =
      (await sumUploads(tx, {
        uploadedById: input.userId,
        createdAt: { gte: since },
      })) +
      (await sumActiveReservations(tx, { userId: input.userId }, now));
    if (userTotal + size > userLimit) {
      return {
        allowed: false as const,
        scope: "user" as const,
        usedBytes: userTotal,
        limitBytes: userLimit,
      };
    }

    if (input.customerId) {
      const customerTotal =
        (await sumUploads(tx, { customerId: input.customerId })) +
        (await sumActiveReservations(
          tx,
          { customerId: input.customerId },
          now,
        ));
      if (customerTotal + size > customerLimit) {
        return {
          allowed: false as const,
          scope: "customer" as const,
          usedBytes: customerTotal,
          limitBytes: customerLimit,
        };
      }
    }

    const expiresAt = new Date(
      now.getTime() + UPLOAD_QUOTA_RESERVATION_TTL_MS,
    );
    const reservation = await tx.uploadQuotaReservation.create({
      data: {
        userId: input.userId,
        customerId: input.customerId,
        size,
        expiresAt,
      },
      select: { id: true },
    });

    return {
      allowed: true as const,
      reservationId: reservation.id,
      reservedBytes: size,
      expiresAt,
    };
  });
}

/**
 * Skriver `Upload`-raden og frigjør reservasjonen i én transaksjon.
 *
 * Hvis den faktiske filstørrelsen er større enn det som ble reservert (for
 * eksempel etter bildekomprimering), kontrolleres kvoten på nytt. Avvises
 * opplastingen, slettes reservasjonen og ingen `Upload`-rad skrives; kalleren
 * må fjerne filen. Da blir verken diskplass eller kvote stående som «brukt».
 */
export async function commitUploadQuota(input: {
  reservationId: string;
  size: number;
  upload: Omit<Prisma.UploadUncheckedCreateInput, "size">;
  now?: Date;
}): Promise<UploadQuotaCommitResult> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS);
  const size = normaliseSize(input.size);

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.uploadQuotaReservation.findUnique({
      where: { id: input.reservationId },
      select: {
        id: true,
        userId: true,
        customerId: true,
        size: true,
        expiresAt: true,
      },
    });
    if (!reservation || reservation.expiresAt.getTime() <= now.getTime()) {
      return { ok: false as const, reason: "missing" as const };
    }

    await lockQuotaSubjects(tx, {
      userId: reservation.userId,
      customerId: reservation.customerId,
    });

    const userLimit = userQuotaBytes();
    const userTotal =
      (await sumUploads(tx, {
        uploadedById: reservation.userId,
        createdAt: { gte: since },
      })) +
      (await sumActiveReservations(
        tx,
        { userId: reservation.userId, id: { not: reservation.id } },
        now,
      ));
    if (userTotal + size > userLimit) {
      await tx.uploadQuotaReservation.delete({
        where: { id: reservation.id },
      });
      return {
        ok: false as const,
        reason: "quota" as const,
        scope: "user" as const,
        usedBytes: userTotal,
        limitBytes: userLimit,
      };
    }

    if (reservation.customerId) {
      const customerLimit = customerQuotaBytes();
      const customerTotal =
        (await sumUploads(tx, { customerId: reservation.customerId })) +
        (await sumActiveReservations(
          tx,
          {
            customerId: reservation.customerId,
            id: { not: reservation.id },
          },
          now,
        ));
      if (customerTotal + size > customerLimit) {
        await tx.uploadQuotaReservation.delete({
          where: { id: reservation.id },
        });
        return {
          ok: false as const,
          reason: "quota" as const,
          scope: "customer" as const,
          usedBytes: customerTotal,
          limitBytes: customerLimit,
        };
      }
    }

    await tx.upload.create({
      data: { ...input.upload, size },
      select: { id: true },
    });
    await tx.uploadQuotaReservation.delete({
      where: { id: reservation.id },
    });

    return { ok: true as const };
  });
}

/** Frigjør en reservasjon uten å skrive noe. Idempotent. */
export async function releaseUploadQuota(reservationId: string): Promise<void> {
  await prisma.uploadQuotaReservation.deleteMany({
    where: { id: reservationId },
  });
}

/** Rydder reservasjoner fra krasjede eller avbrutte opplastinger. */
export async function releaseExpiredUploadQuotaReservations(
  now = new Date(),
): Promise<number> {
  const deleted = await prisma.uploadQuotaReservation.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return deleted.count;
}

/**
 * Kontrollerer kvotene uten å reservere plass.
 *
 * Beholdes for diagnose og tester. Opplastingsruten bruker
 * `reserveUploadQuota`, fordi en ren lesning ikke er atomisk under samtidige
 * opplastinger.
 */
export async function checkUploadQuota(input: {
  userId: string;
  customerId: string | null;
  size: number;
  now?: Date;
}): Promise<UploadQuotaResult> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS);
  const size = normaliseSize(input.size);

  const userLimit = userQuotaBytes();
  const userTotal =
    (await sumUploads(prisma, {
      uploadedById: input.userId,
      createdAt: { gte: since },
    })) + (await sumActiveReservations(prisma, { userId: input.userId }, now));
  if (userTotal + size > userLimit) {
    return {
      allowed: false,
      scope: "user",
      usedBytes: userTotal,
      limitBytes: userLimit,
    };
  }

  if (input.customerId) {
    const customerLimit = customerQuotaBytes();
    const customerTotal =
      (await sumUploads(prisma, { customerId: input.customerId })) +
      (await sumActiveReservations(
        prisma,
        { customerId: input.customerId },
        now,
      ));
    if (customerTotal + size > customerLimit) {
      return {
        allowed: false,
        scope: "customer",
        usedBytes: customerTotal,
        limitBytes: customerLimit,
      };
    }
  }

  return { allowed: true };
}
