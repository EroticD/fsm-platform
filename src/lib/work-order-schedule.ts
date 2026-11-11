import type { Prisma } from "@prisma/client";
import { dateOnlyInOslo, parseDateOnly } from "@/lib/dates";

/**
 * Avleder oppdragets `scheduledFor`/`scheduledTo` fra visittene.
 *
 * Datoene regnes i Europe/Oslo, ikke UTC. `endsAt` er eksklusiv, så siste
 * kalenderdag finnes ved å trekke fra ett millisekund før datoen leses. En
 * heldagsvisitt som slutter ved midnatt gir dermed ikke en ekstra dag på
 * oppdraget. Uten aktive visiter tømmes begge feltene.
 *
 * Funksjonen ligger i `lib` og ikke i `server/visits` fordi både
 * tjenestelaget og livssyklusryddingen trenger den. Da kan skript og jobber
 * bruke den uten å dra inn hele tjenestemodulen.
 */
export async function recomputeWorkOrderSchedule(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<void> {
  const bounds = await tx.visit.aggregate({
    where: {
      workOrderId,
      status: { not: "CANCELLED" },
    },
    _min: { startsAt: true },
    _max: { endsAt: true },
  });

  const firstStart = bounds._min.startsAt;
  const lastEnd = bounds._max.endsAt;

  let scheduledFor: Date | null = null;
  let scheduledTo: Date | null = null;

  if (firstStart && lastEnd) {
    const lastIncludedInstant = new Date(lastEnd.getTime() - 1);
    scheduledFor = parseDateOnly(dateOnlyInOslo(firstStart));
    scheduledTo = parseDateOnly(dateOnlyInOslo(lastIncludedInstant));

    if (scheduledFor && scheduledTo && scheduledTo < scheduledFor) {
      scheduledTo = scheduledFor;
    }
  }

  await tx.workOrder.update({
    where: { id: workOrderId },
    data: { scheduledFor, scheduledTo },
  });
}
