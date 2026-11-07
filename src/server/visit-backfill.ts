import type { Prisma, PrismaClient } from "@prisma/client";
import { planBackfillSplit } from "@/lib/work-days";

/**
 * Engangsbackfill for eldre flerdagers heldagsvisiter.
 *
 * Den nye modellen har én arbeidsøkt (`Visit`, `allDay: true`) per
 * kalenderdag. Eldre data kan ha én heldagsvisitt som strekker seg over flere
 * dager. Denne funksjonen deler den i daglige økter:
 *
 * - originalraden beholdes som første dag og beholder status, tidsstempler,
 *   notater og montører,
 * - øvrige dager opprettes som rene, planlagte økter med samme montører,
 * - ingen tidsstempler kopieres, så fullført arbeid dupliseres aldri.
 *
 * Funksjonen er idempotent: en rad som allerede dekker én dag hoppes over.
 */
export type BackfillClient = Pick<
  PrismaClient,
  "visit" | "visitTechnician" | "$transaction"
>;

export type BackfillResult = {
  scanned: number;
  split: number;
  created: number;
  dryRun: boolean;
};

export async function splitMultiDayAllDayVisits(
  client: BackfillClient,
  options: { dryRun?: boolean; take?: number } = {},
): Promise<BackfillResult> {
  const dryRun = options.dryRun === true;
  const take = Math.min(Math.max(options.take ?? 10_000, 1), 50_000);
  const visits = await client.visit.findMany({
    where: { allDay: true },
    select: {
      id: true,
      workOrderId: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      sequence: true,
      technicians: { select: { userId: true } },
    },
    orderBy: [{ workOrderId: "asc" }, { startsAt: "asc" }],
    take,
  });

  let split = 0;
  let created = 0;

  for (const visit of visits) {
    const plan = planBackfillSplit(visit);
    if (!plan) continue;
    split += 1;
    created += plan.create.length;
    if (dryRun) continue;

    await client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.visit.update({
        where: { id: plan.keep.id },
        data: {
          startsAt: plan.keep.startsAt,
          endsAt: plan.keep.endsAt,
          sequence: plan.keep.sequence,
          allDay: true,
        },
      });

      const technicianIds = visit.technicians.map(
        (technician) => technician.userId,
      );
      for (const day of plan.create) {
        await tx.visit.create({
          data: {
            workOrderId: visit.workOrderId,
            sequence: day.sequence,
            startsAt: day.startsAt,
            endsAt: day.endsAt,
            allDay: true,
            status: "PLANNED",
            technicians: {
              create: technicianIds.map((userId) => ({ userId })),
            },
          },
          select: { id: true },
        });
      }
    });
  }

  return { scanned: visits.length, split, created, dryRun };
}
