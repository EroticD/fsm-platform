import prisma from "@/lib/prisma";
import { fail, ok, type ServiceActor, type ServiceResult } from "./actor";

/**
 * Sentral tilgangskontroll for kundeportalen.
 *
 * Kundeportalen har én identitet (kunden) og eventuelt én kontaktperson med
 * delegert tilgang. All portaltilgang går gjennom denne modulen, slik at en ny
 * rute eller tjeneste ikke kan glemme delegasjonen. En kontakt uten
 * `PortalDelegation` beholder full portaltilgang for bakoverkompatibilitet;
 * en inaktiv delegasjon stenger portalen helt.
 */

export type PortalCapability =
  | "canBook"
  | "canViewDocuments"
  | "canViewContracts"
  | "canViewEquipment";

export type PortalCapabilities = Record<PortalCapability, boolean>;

export type PortalDelegationSnapshot = {
  id: string;
  canBook: boolean;
  canViewDocuments: boolean;
  canViewContracts: boolean;
  canViewEquipment: boolean;
  isActive: boolean;
};

export type PortalAccess = {
  actor: ServiceActor;
  customerId: string;
  contactId: string | null;
  /** Satt når kontakten har en delegasjonsrad. */
  delegation: PortalDelegationSnapshot | null;
  capabilities: PortalCapabilities;
};

export const FULL_PORTAL_CAPABILITIES: PortalCapabilities = {
  canBook: true,
  canViewDocuments: true,
  canViewContracts: true,
  canViewEquipment: true,
};

/** Ren funksjon, slik at delegasjonsmatrisen kan testes uten database. */
export function portalCapabilitiesFor(
  delegation:
    | Pick<
        PortalDelegationSnapshot,
        PortalCapability | "isActive"
      >
    | null
    | undefined,
): PortalCapabilities {
  if (!delegation) return { ...FULL_PORTAL_CAPABILITIES };
  return {
    canBook: delegation.canBook,
    canViewDocuments: delegation.canViewDocuments,
    canViewContracts: delegation.canViewContracts,
    canViewEquipment: delegation.canViewEquipment,
  };
}

export function portalAccessAllows(
  access: PortalAccess | null | undefined,
  capability: PortalCapability,
): boolean {
  return Boolean(access?.capabilities[capability]);
}

/**
 * Slår opp kunden, kontakten og delegasjonen til en innlogget aktør.
 *
 * En CUSTOMER uten kundetilknytning, en slettet kunde eller en kontakt som
 * ikke tilhører kunden avvises. Kontaktens delegasjon må være aktiv når den
 * finnes; ellers er hele portalen stengt for den kontakten.
 */
export async function resolvePortalAccess(
  actor: ServiceActor | null | undefined,
): Promise<ServiceResult<PortalAccess>> {
  if (!actor?.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const customer = await prisma.customer.findFirst({
    where: { id: actor.customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) return fail("forbidden");

  const contactId = actor.contactId ?? null;
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, customerId: customer.id },
      select: { id: true },
    });
    if (!contact) return fail("forbidden");
  }

  const delegation = contactId
    ? await prisma.portalDelegation.findUnique({
        where: { contactId },
        select: {
          id: true,
          canBook: true,
          canViewDocuments: true,
          canViewContracts: true,
          canViewEquipment: true,
          isActive: true,
        },
      })
    : null;
  if (delegation && !delegation.isActive) return fail("forbidden");

  return ok({
    actor,
    customerId: customer.id,
    contactId,
    delegation,
    capabilities: portalCapabilitiesFor(delegation),
  });
}

/** Bekvemmelighet for tjenester som krever én bestemt portalkapabilitet. */
export async function requirePortalCapability(
  actor: ServiceActor | null | undefined,
  capability: PortalCapability,
): Promise<ServiceResult<PortalAccess>> {
  const access = await resolvePortalAccess(actor);
  if (!access.ok) return access;
  if (!portalAccessAllows(access.data, capability)) return fail("forbidden");
  return access;
}
