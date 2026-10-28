import type { Prisma } from "@prisma/client";

/**
 * Spørringsfilter for «i dag» i oppdragslisten.
 *
 * Datoene er rene kalenderdatoer lagret som UTC-midnatt. `endOfToday` er
 * midnatt ved starten av neste dag, så vi må bruke streng `lt` – med `lte`
 * ville oppdrag som starter i morgen kl. 00:00 telt som «i dag».
 *
 * Flerdagersoppdrag tas med når perioden dekker dagen: enten fordi sluttdatoen
 * er i dag eller senere, eller fordi det er et éndagsoppdrag som starter i dag.
 */
export function scheduledTodayWhere(
  startOfToday: Date,
  endOfToday: Date,
): Prisma.WorkOrderWhereInput {
  return {
    scheduledFor: { lt: endOfToday },
    OR: [
      { scheduledTo: { gte: startOfToday } },
      { scheduledTo: null, scheduledFor: { gte: startOfToday } },
    ],
  };
}
