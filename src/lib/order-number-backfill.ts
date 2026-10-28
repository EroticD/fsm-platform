import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Backfill av `WorkOrder.orderNumberNormalized` for eldre rader.
 *
 * Samme normalisering som `normalizeOrderNumber` i `lib/order-number.ts`:
 * trim, store bokstaver og fjern alt som ikke er bokstaver eller tall.
 * `orderNumber` (visningsverdien) endres aldri.
 *
 * Funksjonen sjekker først om to rader i samme avdeling ville fått samme
 * normaliserte verdi. Da avbrytes hele kjøringen uten å skrive noe, slik at
 * den unike indeksen ikke skal måtte «velge» hvilket ordrenummer som vinner.
 */
const NORMALIZED_ORDER_NUMBER = Prisma.raw(
  `nullif(regexp_replace(upper(btrim("orderNumber")), '[^[:alnum:]]', '', 'g'), '')`,
);

/** Normalisert verdi slik raden vil se ut etter backfillen. */
const FINAL_ORDER_NUMBER_NORMALIZED = Prisma.raw(
  `coalesce(nullif(regexp_replace(upper(btrim("orderNumber")), '[^[:alnum:]]', '', 'g'), ''), "orderNumberNormalized")`,
);

export type OrderNumberCollision = {
  departmentId: string;
  normalized: string;
  count: number;
};

export type OrderNumberBackfillResult =
  | { ok: true; updated: number; collisions: [] }
  | { ok: false; updated: 0; collisions: OrderNumberCollision[] };

export async function findOrderNumberNormalizationCollisions(): Promise<
  OrderNumberCollision[]
> {
  return prisma.$queryRaw<OrderNumberCollision[]>(Prisma.sql`
    SELECT
      w."departmentId" AS "departmentId",
      ${FINAL_ORDER_NUMBER_NORMALIZED} AS "normalized",
      count(*)::int AS "count"
    FROM "WorkOrder" w
    WHERE w."orderNumber" IS NOT NULL OR w."orderNumberNormalized" IS NOT NULL
    GROUP BY w."departmentId", ${FINAL_ORDER_NUMBER_NORMALIZED}
    HAVING ${FINAL_ORDER_NUMBER_NORMALIZED} IS NOT NULL
       AND count(*) > 1
    ORDER BY w."departmentId", "normalized"
  `);
}

/** Oppdaterer normaliserte ordrenumre, eller avbryter ved kollisjon. */
export async function backfillOrderNumbers(): Promise<OrderNumberBackfillResult> {
  const collisions = await findOrderNumberNormalizationCollisions();
  if (collisions.length > 0) {
    return { ok: false, updated: 0, collisions };
  }

  const updated = await prisma.$executeRaw(Prisma.sql`
    UPDATE "WorkOrder"
    SET "orderNumberNormalized" = ${NORMALIZED_ORDER_NUMBER}
    WHERE "orderNumber" IS NOT NULL
      AND "orderNumberNormalized" IS DISTINCT FROM ${NORMALIZED_ORDER_NUMBER}
  `);

  return { ok: true, updated, collisions: [] };
}
