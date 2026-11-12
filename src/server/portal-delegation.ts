// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning, på samme måte som de øvrige kundetjenestene.
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  can,
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import { logServerError } from "@/lib/log-context";

/**
 * Skriver delegerte portaltilganger for en kontaktperson.
 *
 * En kontakt uten `PortalDelegation` beholder full portaltilgang for
 * bakoverkompatibilitet. Så snart kontoret lagrer en rad, gjelder de
 * eksplisitte flaggene – også når alle er av. Endringen slår inn på neste
 * forespørsel fordi `resolvePortalAccess` leser delegasjonen på nytt hver gang.
 */

export type PortalDelegationInput = {
  contactId?: unknown;
  isActive?: unknown;
  canBook?: unknown;
  canViewDocuments?: unknown;
  canViewContracts?: unknown;
  canViewEquipment?: unknown;
};

export type PortalDelegationRecord = {
  contactId: string;
  isActive: boolean;
  canBook: boolean;
  canViewDocuments: boolean;
  canViewContracts: boolean;
  canViewEquipment: boolean;
};

function flag(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

async function contactForCustomer(contactId: string, customerId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, customerId },
    select: { id: true, name: true },
  });
}

/** Lagrer (eller oppdaterer) delegasjonen for én kontakt på kundekortet. */
export async function savePortalDelegation(
  actor: ServiceActor,
  customerId: string,
  input: PortalDelegationInput,
): Promise<ServiceResult<PortalDelegationRecord>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const contactId = cleanText(input.contactId, { maxLength: LIMITS.line });
  if (!contactId) return fail("invalid");

  const contact = await contactForCustomer(contactId, customerId);
  if (!contact) return fail("invalid_contact");

  const data = {
    isActive: flag(input.isActive),
    canBook: flag(input.canBook),
    canViewDocuments: flag(input.canViewDocuments),
    canViewContracts: flag(input.canViewContracts),
    canViewEquipment: flag(input.canViewEquipment),
  };

  try {
    const delegation = await prisma.$transaction(async (tx) => {
      const saved = await tx.portalDelegation.upsert({
        where: { contactId },
        update: data,
        create: { contactId, ...data },
        select: {
          contactId: true,
          isActive: true,
          canBook: true,
          canViewDocuments: true,
          canViewContracts: true,
          canViewEquipment: true,
        },
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Endret portaldelegering: ${contact.name || "Ukjent kontakt"}`,
        actor: toAuditActor(actor),
        metadata: {
          contactId,
          ...data,
        },
      });
      return saved;
    });
    return ok(delegation);
  } catch (error) {
    await logServerError("Feil ved lagring av portaldelegering", error, { customerId });
    return fail("error");
  }
}
