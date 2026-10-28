import type { Prisma } from "@prisma/client";
import { parseDateOnly, type DateOnly } from "@/lib/dates";

export type DateRangeParams = {
  from?: string | null;
  to?: string | null;
};

export type ResolvedDateRange = {
  /** Verdiene som skal vises i datofeltene. */
  fromText: string;
  toText: string;
  from: Date | null;
  to: Date | null;
  /** Sann når en dato er ugyldig eller fra er etter til. */
  invalid: boolean;
  invalidOrder: boolean;
};

/**
 * Leser et datofilter fra query-strengen. Manglende parameter gir
 * standardperioden, mens en eksplisitt tom verdi betyr «ingen grense».
 * Ugyldige verdier og fra > til markeres i stedet for å gi et stille tomt kart.
 */
export function resolveDateRange({
  params,
  defaultFrom,
  defaultTo,
}: {
  params: DateRangeParams;
  defaultFrom: DateOnly;
  defaultTo: DateOnly;
}): ResolvedDateRange {
  const fromText =
    params.from === undefined ? defaultFrom : (params.from ?? "").trim();
  const toText = params.to === undefined ? defaultTo : (params.to ?? "").trim();
  const parsedFrom = fromText ? parseDateOnly(fromText) : null;
  const parsedTo = toText ? parseDateOnly(toText) : null;

  const invalidInput =
    (Boolean(fromText) && !parsedFrom) || (Boolean(toText) && !parsedTo);
  const invalidOrder = Boolean(
    parsedFrom && parsedTo && parsedFrom.getTime() > parsedTo.getTime(),
  );

  return {
    fromText,
    toText,
    from: parsedFrom,
    to: parsedTo,
    invalid: invalidInput || invalidOrder,
    invalidOrder,
  };
}

/**
 * Prisma-filter for datoperioden et oppdrag overlapper.
 *
 * `scheduledFor <= dateTo` og `(scheduledTo ?? scheduledFor) >= dateFrom` tar
 * med flerdagsoppdrag som allerede er i gang når perioden starter.
 */
export function scheduledOverlapFilters(
  from: Date | null,
  to: Date | null,
): Prisma.WorkOrderWhereInput[] {
  const filters: Prisma.WorkOrderWhereInput[] = [];

  if (to) filters.push({ scheduledFor: { lte: to } });
  if (from) {
    filters.push({
      OR: [
        { scheduledTo: { gte: from } },
        { scheduledTo: null, scheduledFor: { gte: from } },
      ],
    });
  }

  return filters;
}
