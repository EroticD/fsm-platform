import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { notifyWorkOrderEvent } from "@/server/notifications";
import { contractIntervalLabel } from "@/lib/contracts";
import {
  addDaysUtc,
  firstOccurrenceOnOrAfter,
  formatDate,
  latestOccurrenceOnOrBefore,
  osloDayStart,
  toDateOnly,
} from "@/lib/dates";
import { createDefaultVisit, recomputeWorkOrderSchedule } from "@/server/visits";
import { startClock } from "@/server/sla";

export type RecurringGenerationResult = {
  contractId: string;
  workOrderId?: string;
  scheduledFor?: string;
  skipped?:
    | "inactive"
    | "customer-deleted"
    | "not-due"
    | "already-generated"
    | "not-found"
    | "locked"
    | "ended"
    | "error";
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
 * Låsen er transaksjonsscoped (`pg_try_advisory_xact_lock`). PostgreSQL slipper
 * den automatisk ved commit eller rollback, også når transaksjonen timer ut
 * eller kaster. Da kan låsen aldri bli liggende igjen på en tilkobling i
 * poolen, slik en sesjonsscoped lås kunne bli hvis frigjøringen feilet.
 *
 * Transaksjonen er bevisst kort: den tar låsen, oppdaterer avtalens
 * `nextServiceDate` og oppretter oppdraget i én atomisk enhet. PDF-rendring,
 * vedlegg og varsling skjer etter commit, utenfor låsen.
 */
const CLAIM_TRANSACTION_MAX_WAIT_MS = 5_000;
const CLAIM_TRANSACTION_TIMEOUT_MS = 15_000;

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
  if (
    !contract.isActive ||
    (contract.status && contract.status !== "ACTIVE")
  ) {
    return { contractId, skipped: "inactive" };
  }

  // En mykt slettet kunde skal ikke få nye serviceoppdrag. Avtalen røres ikke:
  // den kan gjenopprettes sammen med kunden uten en overraskende statusendring.
  if (contract.customer.deletedAt) {
    logger.info("Serviceavtaler: hopper over avtale for slettet kunde", {
      contractId: contract.id,
    });
    return { contractId, skipped: "customer-deleted" };
  }

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

  // En avtale som er utløpt skal ikke generere service etter sluttdatoen.
  // Automatisk fornyelse flytter endDate før denne jobben kjører.
  if (contract.endDate && toDateOnly(contract.endDate) < toDateOnly(due)) {
    return { contractId, skipped: "ended" };
  }

  // Forrige oppdrag på samme avtale som faktisk har en ikke-slettet rapport.
  // Hvis det umiddelbart forrige oppdraget ikke er fullført, brukes siste
  // tilgjengelige rapport i stedet – den er fortsatt den siste servicen kunden
  // har fått. Slettede oppdrag og rapporter skal aldri gjenoppstå som vedlegg.
  const previous = await prisma.workOrder.findFirst({
    where: {
      contractId: contract.id,
      scheduledFor: { lt: due },
      deletedAt: null,
      reports: { some: { deletedAt: null } },
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

  let claim:
    | { status: "created"; workOrderId: string }
    | { status: "locked" }
    | { status: "already-generated" };

  try {
    claim = await prisma.$transaction(
      async (tx) => {
        // Transaksjonsscoped lås: PostgreSQL slipper den ved commit/rollback.
        // Låsen tas i samme korte transaksjon som selve kravet på avtalen.
        if (!(await tryAcquireRecurringLock(tx))) {
          return { status: "locked" as const };
        }

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

        if (updated.count === 0) {
          return { status: "already-generated" as const };
        }

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

        // Serviceoppdraget er datofestet og skal ha én planlagt all-day-visitt.
        // Avtalen tildeler ingen montører, så visitten starter uten.
        await createDefaultVisit(tx, {
          workOrderId: workOrder.id,
          startsAt: osloDayStart(toDateOnly(due)),
          endsAt: osloDayStart(toDateOnly(addDaysUtc(due, 1))),
          allDay: true,
        });
        await recomputeWorkOrderSchedule(tx, workOrder.id);

        // Avtalens SLA-policy – eller avdelingens standard – starter klokken
        // i samme transaksjon som oppdraget. Uten policy blir det ingen klokke.
        await startClock(tx, workOrder.id, {
          policyId: contract.slaPolicyId ?? null,
          now,
        });

        await tx.auditLog.create({
          data: {
            entityType: "WorkOrder",
            entityId: workOrder.id,
            action: `Opprettet gjentagende oppdrag fra serviceavtalen «${contract.title}»`,
            userName: "Serviceavtale",
            metadata: { customerId: contract.customerId, contractId: contract.id },
          },
        });

        return { status: "created" as const, workOrderId: workOrder.id };
      },
      {
        maxWait: CLAIM_TRANSACTION_MAX_WAIT_MS,
        timeout: CLAIM_TRANSACTION_TIMEOUT_MS,
      },
    );
  } catch (error) {
    // `@@unique([contractId, scheduledFor])` er siste skanse mot to samtidige
    // kjøringer. En slik kollisjon er ikke en feil – oppdraget finnes allerede.
    if (isUniqueViolation(error)) {
      return { contractId, skipped: "already-generated" };
    }
    // Transaksjonen rulles tilbake og den transaksjonsscoped låsen frigjøres
    // automatisk, selv om feilen skyldes timeout eller en tapt tilkobling.
    throw error;
  }

  if (claim.status === "locked") {
    logger.info("Serviceavtaler: låsen er opptatt, hopper over avtalen", {
      contractId: contract.id,
    });
    return { contractId, skipped: "locked" };
  }

  if (claim.status === "already-generated") {
    return { contractId, skipped: "already-generated" };
  }

  const workOrderId = claim.workOrderId;

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
        logger.warn("Serviceavtale: fant ingen PDF av forrige rapport", {
          contractId: contract.id,
        });
      }
    } catch (error) {
      // PDF-en er en bekvemmelighet. Oppdraget skal bestå selv om vedlegget
      // ikke kunne lages.
      logger.error("Kunne ikke legge ved forrige rapport", {
        contractId: contract.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await notifyWorkOrderEvent(
      workOrderId,
      "CONTRACT_DUE",
      "Serviceavtale forfaller",
      `Nytt oppdrag er opprettet for ${contract.title}.`,
      `/oppdrag/${workOrderId}`,
      `contract-due:${workOrderId}`,
    );
  } catch {
    // Varsling er best effort.
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
    SELECT pg_try_advisory_xact_lock(${RECURRING_ADVISORY_LOCK_ID}::bigint) AS locked
  `;
  return rows[0]?.locked === true;
}

/** Selve genereringen. Hver avtale kravsettes i sin egen korte transaksjon. */
async function generateDueRecurringWorkOrdersBatch(
  now: Date,
): Promise<RecurringGenerationResult[]> {
  const contracts = await prisma.contract.findMany({
    where: {
      isActive: true,
      status: "ACTIVE",
      nextServiceDate: { lte: now },
      // Mykt slettede kunder skal ikke lenger generere serviceoppdrag.
      customer: { deletedAt: null },
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
        logger.error("Kunne ikke generere serviceavtale-oppdrag", {
          contractId: contract.id,
          error: error instanceof Error ? error.message : String(error),
        });
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

    logger.info("Serviceavtaler: generering fullført", {
      created,
      skipped,
      errors,
      due: contracts.length,
    });
  }

  return results;
}

/**
 * Finner alle aktive avtaler som har forfalt og genererer ett oppdrag hver.
 *
 * Hver avtale kravsettes i en kort transaksjon beskyttet av en
 * transaksjonsscoped Postgres advisory lock. To app-instanser (eller den
 * innebygde jobben og en ekstern cron) kan derfor ikke lage samme oppdrag
 * samtidig, og låsen frigjøres automatisk ved commit/rollback. Er låsen
 * opptatt for en avtale, hoppes den over og tas ved neste kjøring.
 */
export async function generateDueRecurringWorkOrders(
  now = new Date(),
): Promise<RecurringGenerationResult[]> {
  return generateDueRecurringWorkOrdersBatch(now);
}
