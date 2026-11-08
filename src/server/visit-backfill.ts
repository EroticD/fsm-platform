import type { Prisma, PrismaClient } from "@prisma/client";
import { dateOnlyInOslo } from "@/lib/dates";
import {
  planBackfillSplit,
  planLegacyTimedNormalisation,
  type LegacyTimedReportReason,
} from "@/lib/work-days";

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

/** En eldre tidsstyrt visitt som ikke kan normaliseres uten å gjette. */
export type LegacyTimedBackfillReport = {
  id: string;
  workOrderId: string;
  /** Kalenderdato i Europe/Oslo, eller null når tidsrommet er ugyldig. */
  date: string | null;
  reason:
    | LegacyTimedReportReason
    | "several-same-day"
    | "work-day-conflict"
    | "changed-during-apply";
};

export type LegacyTimedBackfillResult = {
  scanned: number;
  normalised: number;
  reported: number;
  dryRun: boolean;
  reports: LegacyTimedBackfillReport[];
};

type LegacyTimedRow = {
  id: string;
  workOrderId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  sequence: number;
  enRouteAt: Date | null;
  onSiteAt: Date | null;
  doneAt: Date | null;
  travelFromEndedAt: Date | null;
};

type SiblingRow = {
  id: string;
  workOrderId: string;
  startsAt: Date;
  endsAt: Date;
};

function rangesOverlap(
  first: { startsAt: Date; endsAt: Date },
  second: { startsAt: Date; endsAt: Date },
): boolean {
  return (
    first.startsAt.getTime() < second.endsAt.getTime() &&
    first.endsAt.getTime() > second.startsAt.getTime()
  );
}

/**
 * Normaliserer eldre tidsstyrte enkeltdagsvisiter til én heldagsøkt.
 *
 * Den nye modellen har nøyaktig én `Visit` (`allDay: true`) per arbeidsdag, med
 * faktisk tid i `enRouteAt`/`onSiteAt`/`doneAt`/`travelFromEndedAt`. Eldre rader
 * kan være tidsstyrte (`allDay: false`). Denne funksjonen:
 *
 * - utvider start/slutt til hele arbeidsdagen og setter `allDay: true`,
 * - lar alle tidsstempler, status, notater og montører stå urørt,
 * - lar rader med flere visiter samme dag, tidsstempler utenfor dagen eller
 *   flerdagers tidsrom være i fred og rapporterer dem eksplisitt.
 *
 * Ingen nye rader opprettes, så et tidsstempel kan aldri dupliseres. Funksjonen
 * er idempotent: normaliserte rader har `allDay: true` og skannes ikke igjen.
 */
export async function normaliseLegacyTimedVisits(
  client: BackfillClient,
  options: { dryRun?: boolean; take?: number } = {},
): Promise<LegacyTimedBackfillResult> {
  const dryRun = options.dryRun === true;
  const take = Math.min(Math.max(options.take ?? 10_000, 1), 50_000);
  const visits: LegacyTimedRow[] = await client.visit.findMany({
    where: { allDay: false },
    select: {
      id: true,
      workOrderId: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      sequence: true,
      enRouteAt: true,
      onSiteAt: true,
      doneAt: true,
      travelFromEndedAt: true,
    },
    orderBy: [{ workOrderId: "asc" }, { startsAt: "asc" }],
    take,
  });

  if (visits.length === 0) {
    return {
      scanned: 0,
      normalised: 0,
      reported: 0,
      dryRun,
      reports: [],
    };
  }

  // Alle visiter på de berørte oppdragene, slik at vi kan oppdage om dagen
  // allerede er opptatt av en annen økt.
  const workOrderIds = [...new Set(visits.map((visit) => visit.workOrderId))];
  const siblings: SiblingRow[] = await client.visit.findMany({
    where: { workOrderId: { in: workOrderIds } },
    select: {
      id: true,
      workOrderId: true,
      startsAt: true,
      endsAt: true,
    },
  });
  const siblingsByOrder = new Map<string, SiblingRow[]>();
  for (const sibling of siblings) {
    const list = siblingsByOrder.get(sibling.workOrderId) ?? [];
    list.push(sibling);
    siblingsByOrder.set(sibling.workOrderId, list);
  }

  // Teller hvor mange tidsstyrte rader som ligger på samme oppdrag og dag.
  const perDay = new Map<string, number>();
  for (const visit of visits) {
    const key = `${visit.workOrderId}:${dateOnlyInOslo(visit.startsAt)}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const reports: LegacyTimedBackfillReport[] = [];
  const plans: Array<{
    visit: LegacyTimedRow;
    date: string;
    startsAt: Date;
    endsAt: Date;
  }> = [];

  for (const visit of visits) {
    const plan = planLegacyTimedNormalisation(visit);
    if ("reason" in plan) {
      reports.push({
        id: visit.id,
        workOrderId: visit.workOrderId,
        date: dateOnlyInOslo(visit.startsAt),
        reason: plan.reason,
      });
      continue;
    }

    const date = plan.date;
    if ((perDay.get(`${visit.workOrderId}:${date}`) ?? 0) > 1) {
      reports.push({
        id: visit.id,
        workOrderId: visit.workOrderId,
        date,
        reason: "several-same-day",
      });
      continue;
    }

    const conflict = (siblingsByOrder.get(visit.workOrderId) ?? []).some(
      (sibling) =>
        sibling.id !== visit.id &&
        rangesOverlap(sibling, { startsAt: plan.startsAt, endsAt: plan.endsAt }),
    );
    if (conflict) {
      reports.push({
        id: visit.id,
        workOrderId: visit.workOrderId,
        date,
        reason: "work-day-conflict",
      });
      continue;
    }

    plans.push({
      visit,
      date,
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
    });
  }

  let normalised = 0;
  for (const plan of plans) {
    if (dryRun) {
      normalised += 1;
      continue;
    }

    // Optimistisk vakt: raden må fortsatt være den samme tidsstyrte visitten vi
    // planla ut fra. Er den endret i mellomtiden, rapporteres den i stedet.
    const updated = await client.visit.updateMany({
      where: {
        id: plan.visit.id,
        allDay: false,
        startsAt: plan.visit.startsAt,
        endsAt: plan.visit.endsAt,
      },
      data: {
        allDay: true,
        startsAt: plan.startsAt,
        endsAt: plan.endsAt,
      },
    });
    if (updated.count === 1) {
      normalised += 1;
    } else {
      reports.push({
        id: plan.visit.id,
        workOrderId: plan.visit.workOrderId,
        date: plan.date,
        reason: "changed-during-apply",
      });
    }
  }

  return {
    scanned: visits.length,
    normalised,
    reported: reports.length,
    dryRun,
    reports,
  };
}
