import { WorkStatus, type Prisma } from "@prisma/client";

export type ReportRange = "denne-maneden" | "forrige-maned" | "alle";

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Filter for rapportlisten.
 *
 * `deletedAt: null` gjelder alltid – også for oppdraget – og legges ved siden
 * av tidsrommet i stedet for å bli erstattet av det. Ansatte med reports.view
 * ser rapporter fra alle avdelinger; det er bare oppdragslistene som er
 * avdelingsavgrensede. Montører skjuler i tillegg kansellerte oppdrag.
 */
export function reportWhereFor(
  range: ReportRange,
  excludeCancelled = false,
): Prisma.ReportWhereInput {
  const now = new Date();
  let dateFilter: Prisma.ReportWhereInput = {};
  if (range === "denne-maneden") {
    dateFilter = { completedAt: { gte: startOfMonth(now) } };
  } else if (range === "forrige-maned") {
    dateFilter = {
      completedAt: {
        gte: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        lt: startOfMonth(now),
      },
    };
  }

  return {
    AND: [
      { deletedAt: null },
      dateFilter,
      {
        workOrder: {
          deletedAt: null,
          ...(excludeCancelled
            ? { status: { not: WorkStatus.CANCELLED } }
            : {}),
        },
      },
    ],
  };
}
