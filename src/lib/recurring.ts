import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { contractIntervalLabel } from "@/lib/contracts";
import {
  addDaysUtc,
  firstOccurrenceOnOrAfter,
  formatDate,
  latestOccurrenceOnOrBefore,
  toDateOnly,
} from "@/lib/dates";

export type RecurringGenerationResult = {
  contractId: string;
  workOrderId?: string;
  scheduledFor?: string;
  skipped?: "inactive" | "not-due" | "already-generated" | "not-found" | "error";
  error?: string;
};

/**
 * Fast nøkkel for Postgres' advisory lock. Samme tall må brukes av alle
 * prosesser som genererer serviceavtale-oppdrag.
 */
export const RECURRING_ADVISORY_LOCK_ID = 918273;

/** Hvor mange avtaler som behandles før vi går videre til neste bolk. */
const CONTRACT_BATCH_SIZE = 50;

/**
 * Låsen holdes i en interaktiv transaksjon, slik at `pg_try_advisory_lock` og
 * `pg_advisory_unlock` garantert går på samme tilkobling. En vanlig
 * `$queryRaw` kan havne på to ulike tilkoblinger i poolen, og da ville låsen
 * blitt hengende.
 *
 * Transaksjonen er bare en måte å feste tilkoblingen på; selve arbeidet kjøres
 * med den vanlige Prisma-klienten. En avtale som tar svært lang tid kan derfor
 * i teorien nå tidsgrensen, men jobben er avgrenset til forfalte avtaler.
 */
const LOCK_TRANSACTION_TIMEOUT_MS = 30 * 60 * 1000;

/** Er feilen en unikhetskollisjon (P2002), f.eks. samme avtale og dato? */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Oppretter neste oppdrag for én serviceavtale.
 *
 * - Oppdraget får kunde, kontaktperson og sjekklistemal fra avtalen.
 * - Rapporten er alltid ny; tidligere svar kopieres aldri.
 * - Er det en tidligere rapport på avtalen, legges den ved som PDF etter at
 *   oppdraget er lagret. Feiler PDF-en, beholdes oppdraget uten vedlegg.
 * - `nextServiceDate` flyttes til neste framtidige forekomst. Har
 *   bakgrunnsjobben vært nede, brukes den siste forekomsten som faktisk har
 *   forfalt, slik at man ikke får en haug med gamle oppdrag.
 */
export async function generateRecurringWorkOrderForContract(
  contractId: string,
  now = new Date(),
): Promise<RecurringGenerationResult> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      customer: {
        include: {
          contacts: { orderBy: { name: "asc" }, take: 1 },
        },
      },
    },
  });

  if (!contract) return { contractId, skipped: "not-found" };
  if (!contract.isActive) return { contractId, skipped: "inactive" };

  const due = latestOccurrenceOnOrBefore(
    contract.startDate,
    contract.intervalMonths,
    now,
  );

  // Avtaler som starter i framtiden, eller som allerede er generert for denne
  // perioden, skal ikke få et nytt oppdrag.
  if (due > now || toDateOnly(due) < toDateOnly(contract.nextServiceDate)) {
    return { contractId, skipped: "not-due" };
  }

  // Forrige oppdrag på samme avtale som faktisk har en rapport. Hvis det
  // umiddelbart forrige oppdraget ikke er fullført, brukes siste tilgjengelige
  // rapport i stedet – den er fortsatt den siste servicen kunden har fått.
  const previous = await prisma.workOrder.findFirst({
    where: {
      contractId: contract.id,
      scheduledFor: { lt: due },
      reports: { some: {} },
    },
    orderBy: { scheduledFor: "desc" },
    select: { id: true, scheduledFor: true },
  });

  const nextServiceDate = firstOccurrenceOnOrAfter(
    contract.startDate,
    contract.intervalMonths,
    addDaysUtc(due, 1),
  );

  const baseDescription =
    `Gjentagende serviceavtale – intervall ${contractIntervalLabel(contract.intervalMonths)}.`;

  let workOrderId: string | null = null;

  try {
    workOrderId = await prisma.$transaction(async (tx) => {
      // Sjekk og oppdater avtalen i samme transaksjon. Da kan ikke
      // bakgrunnsjobben og en manuell handling lage to oppdrag samtidig.
      const updated = await tx.contract.updateMany({
        where: {
          id: contract.id,
          isActive: true,
          nextServiceDate: contract.nextServiceDate,
        },
        data: { nextServiceDate },
      });

      if (updated.count === 0) return null;

      const workOrder = await tx.workOrder.create({
        data: {
          title: contract.title,
          description: baseDescription,
          departmentId: contract.departmentId,
          customerId: contract.customerId,
          contactId: contract.contactId ?? contract.customer.contacts[0]?.id ?? null,
          scheduledFor: due,
          status: "PLANNED",
          creatorName: "Serviceavtale",
          contractId: contract.id,
          templates: contract.templateId
            ? { connect: { id: contract.templateId } }
            : undefined,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "WorkOrder",
          entityId: workOrder.id,
          action: `Opprettet gjentagende oppdrag fra serviceavtalen «${contract.title}»`,
          userName: "Serviceavtale",
        },
      });

      return workOrder.id;
    });
  } catch (error) {
    // `@@unique([contractId, scheduledFor])` er siste skanse mot to samtidige
    // kjøringer. En slik kollisjon er ikke en feil – oppdraget finnes allerede.
    if (isUniqueViolation(error)) {
      return { contractId, skipped: "already-generated" };
    }
    throw error;
  }

  if (!workOrderId) return { contractId, skipped: "already-generated" };

  // Vedlegget lages først etter at oppdraget er committet. Da kan ikke en
  // PDF-feil rulle tilbake selve oppdraget, og PDF-en blir ikke liggende som
  // en foreldreløs fil dersom transaksjonen feiler. Mellomlagringen i
  // report-pdf-store registrerer `Upload`-raden og rydder opp selv ved feil.
  if (previous) {
    try {
      const { getOrRenderReportPdf } = await import("@/lib/report-pdf-store");
      const pdf = await getOrRenderReportPdf(previous.id);

      if (pdf?.url) {
        const attachmentName =
          `Servicerapport-${formatDate(previous.scheduledFor) || "forrige"}.pdf`;

        await prisma.$transaction([
          prisma.attachment.create({
            data: {
              workOrderId,
              fileName: attachmentName,
              dataUrl: pdf.url,
            },
          }),
          prisma.workOrder.update({
            where: { id: workOrderId },
            data: {
              description: `${baseDescription} Forrige rapport er vedlagt som PDF.`,
            },
          }),
        ]);
      } else {
        console.warn(
          `Serviceavtale ${contract.id}: fant ingen PDF av forrige rapport; oppdraget lages uten vedlegg.`,
        );
      }
    } catch (error) {
      // PDF-en er en bekvemmelighet. Oppdraget skal bestå selv om vedlegget
      // ikke kunne lages.
      console.error(
        `Kunne ikke legge ved forrige rapport for serviceavtale ${contract.id}:`,
        error,
      );
    }
  }

  return {
    contractId,
    workOrderId,
    scheduledFor: due.toISOString(),
  };
}

async function tryAcquireRecurringLock(
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${RECURRING_ADVISORY_LOCK_ID}::bigint) AS locked
  `;
  return rows[0]?.locked === true;
}

async function releaseRecurringLock(tx: Prisma.TransactionClient): Promise<void> {
  try {
    await tx.$queryRaw`
      SELECT pg_advisory_unlock(${RECURRING_ADVISORY_LOCK_ID}::bigint)
    `;
  } catch (error) {
    console.error("Kunne ikke frigjøre serviceavtale-låsen:", error);
  }
}

/** Selve genereringen. Kalles bare av den som holder advisory-låsen. */
async function generateDueRecurringWorkOrdersLocked(
  now: Date,
): Promise<RecurringGenerationResult[]> {
  const contracts = await prisma.contract.findMany({
    where: {
      isActive: true,
      nextServiceDate: { lte: now },
    },
    orderBy: { nextServiceDate: "asc" },
    select: { id: true },
  });

  const results: RecurringGenerationResult[] = [];

  // Avtalene behandles i bolker, slik at en stor etterslep-kø ikke holder på
  // alle resultatene eller alle PDF-rendringene samtidig.
  for (let start = 0; start < contracts.length; start += CONTRACT_BATCH_SIZE) {
    const batch = contracts.slice(start, start + CONTRACT_BATCH_SIZE);

    for (const contract of batch) {
      try {
        results.push(await generateRecurringWorkOrderForContract(contract.id, now));
      } catch (error) {
        console.error(
          `Kunne ikke generere serviceavtale-oppdrag for ${contract.id}:`,
          error,
        );
        results.push({
          contractId: contract.id,
          skipped: "error",
          error: error instanceof Error ? error.message : "Ukjent feil",
        });
      }
    }
  }

  if (contracts.length > 0) {
    const created = results.filter((result) => result.workOrderId).length;
    const errors = results.filter((result) => result.skipped === "error").length;
    const skipped = results.filter(
      (result) => result.skipped && result.skipped !== "error",
    ).length;

    console.log(
      `Serviceavtaler: ${created} opprettet, ${skipped} hoppet over, ${errors} feil` +
        ` (${contracts.length} forfalt).`,
    );
  }

  return results;
}

/**
 * Finner alle aktive avtaler som har forfalt og genererer ett oppdrag hver.
 *
 * Kjøringen er beskyttet av en Postgres advisory lock, slik at to
 * app-instanser (eller den innebygde jobben og en ekstern cron) ikke lager
 * samme oppdrag samtidig. Er låsen opptatt, returneres en tom liste.
 */
export async function generateDueRecurringWorkOrders(
  now = new Date(),
): Promise<RecurringGenerationResult[]> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tryAcquireRecurringLock(tx);
      if (!locked) {
        console.log(
          "Serviceavtaler: en annen prosess genererer allerede; hopper over denne kjøringen.",
        );
        return [];
      }

      try {
        return await generateDueRecurringWorkOrdersLocked(now);
      } finally {
        await releaseRecurringLock(tx);
      }
    },
    { maxWait: 10_000, timeout: LOCK_TRANSACTION_TIMEOUT_MS },
  );
}
