import type { Prisma } from "@prisma/client";
import { workOrderScope, type AccessUser } from "@/lib/access";
import type { ResolvedDateRange } from "@/lib/date-range";
import { addDaysUtc, osloDayStart, toDateOnly } from "@/lib/dates";

/**
 * Felles filter for alle spørringene på dispatch-tavla. Dato og «forfalt /
 * ufordelt» legges på utenfor, slik at søk og avdelingsscope gjelder overalt.
 */
export function dispatchBaseFilters(
  user: AccessUser,
  query: string,
): Prisma.WorkOrderWhereInput[] {
  const filters: Prisma.WorkOrderWhereInput[] = [
    workOrderScope(user),
    { status: { not: "COMPLETED" } },
    { status: { not: "CANCELLED" } },
  ];

  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    filters.push({
      OR: [
        { title: contains },
        { address: contains },
        { city: contains },
        { customer: { name: contains } },
        { orderNumber: contains },
      ],
    });
  }

  return filters;
}

/**
 * Forfalte og ufordelte oppdrag skal alltid vises, uavhengig av valgt
 * datoperiode. Det hindrer at «Uten montør»-varselet åpner en tom tavle.
 */
export function dispatchAttentionConditions(
  today: Date | null,
): Prisma.WorkOrderWhereInput[] {
  const conditions: Prisma.WorkOrderWhereInput[] = [
    { technicians: { none: {} } },
  ];
  if (today) conditions.push({ scheduledFor: { lt: today } });
  return conditions;
}

export function dispatchAttentionWhere(
  baseFilters: Prisma.WorkOrderWhereInput[],
  attentionConditions: Prisma.WorkOrderWhereInput[],
): Prisma.WorkOrderWhereInput {
  return { AND: [...baseFilters, { OR: attentionConditions }] };
}

/**
 * Datoperioden for planlagte visiter.
 *
 * Visiter er tidsstempler, så grensene regnes som Oslo-midnatt for valgte
 * datoer. En visitt som starter på sluttdagen er med, mens neste midnatt er
 * eksklusiv. `NOT` fjerner oppdrag som havner i «Forfalte / Ufordelte», slik at
 * samme kort aldri vises både i varselseksjonen og i en datokolonne.
 */
export function dispatchDateWhere(
  baseFilters: Prisma.WorkOrderWhereInput[],
  range: ResolvedDateRange,
  attentionConditions: Prisma.WorkOrderWhereInput[],
): Prisma.VisitWhereInput {
  const filters: Prisma.VisitWhereInput[] = [
    { status: { not: "CANCELLED" } },
    {
      workOrder: {
        AND: [...baseFilters, { NOT: { OR: attentionConditions } }],
      },
    },
  ];

  if (range.invalid) {
    // Ugyldig periode skal ikke gi et stille, misvisende resultat. Varsler om
    // forfalte/ufordelte vises fortsatt, med feilmeldingen over tavla.
    filters.push({ id: { in: [] } });
  } else {
    if (range.from) {
      filters.push({
        startsAt: { gte: osloDayStart(toDateOnly(range.from)) },
      });
    }
    if (range.to) {
      filters.push({
        startsAt: {
          lt: osloDayStart(toDateOnly(addDaysUtc(range.to, 1))),
        },
      });
    }
  }

  return { AND: filters };
}
