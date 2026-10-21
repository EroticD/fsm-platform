import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { contractIntervalLabel } from "@/lib/contracts";
import {
  addDaysUtc,
  firstOccurrenceOnOrAfter,
  formatDate,
  latestOccurrenceOnOrBefore,
  toDateOnly,
} from "@/lib/dates";
import { uploadDir } from "@/lib/uploads";

export type RecurringGenerationResult = {
  contractId: string;
  workOrderId?: string;
  scheduledFor?: string;
  skipped?: "inactive" | "not-due" | "already-generated" | "not-found" | "error";
  error?: string;
};

/**
 * Oppretter neste oppdrag for én serviceavtale.
 *
 * - Oppdraget får kunde, kontaktperson og sjekklistemal fra avtalen.
 * - Rapporten er alltid ny; tidligere svar kopieres aldri.
 * - Er det en tidligere rapport på avtalen, genereres den som PDF og legges
 *   ved det nye oppdraget.
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

  let pdfFile: { storedName: string; displayName: string } | null = null;

  if (previous) {
    try {
      // Lastes dynamisk for å holde PDF-motoren ute av vanlige sidebundles.
      const { loadReportPdf } = await import("@/lib/report-pdf");
      const pdf = await loadReportPdf(previous.id);
      if (pdf) {
        const storedName = `${crypto.randomUUID()}.pdf`;
        await fs.mkdir(uploadDir(), { recursive: true });
        await fs.writeFile(path.join(uploadDir(), storedName), pdf.buffer);

        pdfFile = {
          storedName,
          displayName: `Servicerapport-${formatDate(previous.scheduledFor) || "forrige"}.pdf`,
        };
      }
    } catch (error) {
      // PDF-en er en bekvemmelighet. Selve oppdraget skal opprettes selv om
      // genereringen feiler, så feilen logges og oppdraget lages uten vedlegg.
      console.error(
        `Kunne ikke lage PDF av forrige rapport for serviceavtale ${contract.id}:`,
        error,
      );
    }
  }

  const nextServiceDate = firstOccurrenceOnOrAfter(
    contract.startDate,
    contract.intervalMonths,
    addDaysUtc(due, 1),
  );

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
          description:
            `Gjentagende serviceavtale – intervall ${contractIntervalLabel(contract.intervalMonths)}.` +
            (pdfFile ? " Forrige rapport er vedlagt som PDF." : ""),
          customerId: contract.customerId,
          contactId: contract.contactId ?? contract.customer.contacts[0]?.id ?? null,
          scheduledFor: due,
          status: "PLANNED",
          creatorName: "Serviceavtale",
          contractId: contract.id,
          templates: contract.templateId
            ? { connect: { id: contract.templateId } }
            : undefined,
          attachments:
            pdfFile !== null
              ? {
                  create: [
                    {
                      fileName: pdfFile.displayName,
                      dataUrl: `/uploads/${pdfFile.storedName}`,
                    },
                  ],
                }
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
    // Transaksjonen rullet tilbake, så den genererte PDF-filen skal ikke bli
    // liggende igjen på volumet.
    if (pdfFile) {
      await fs.unlink(path.join(uploadDir(), pdfFile.storedName)).catch(() => {});
    }
    throw error;
  }

  if (!workOrderId) {
    if (pdfFile) {
      await fs.unlink(path.join(uploadDir(), pdfFile.storedName)).catch(() => {});
    }
    return { contractId, skipped: "already-generated" };
  }

  return {
    contractId,
    workOrderId,
    scheduledFor: due.toISOString(),
  };
}

/** Finner alle aktive avtaler som har forfalt og genererer ett oppdrag hver. */
export async function generateDueRecurringWorkOrders(
  now = new Date(),
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

  for (const contract of contracts) {
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

  return results;
}
