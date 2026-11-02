// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning, på samme måte som de øvrige kundetjenestene.
import type { Prisma } from "@prisma/client";
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

/**
 * Steder (anlegg) for en kunde. Stedene er kundens egne rader, og alle
 * oppslag og skrivinger er avgrenset til `customerId` fra kundekortet – en
 * klient kan aldri peke på en annen kundes sted.
 *
 * Reglene for primærsted:
 * - Den første raden blir primær.
 * - Å sette et nytt primærsted fjerner flagget fra de andre i samme transaksjon.
 * - Sletting av primærstedet forfremmer det eldste gjenstående stedet.
 * Ingen av operasjonene kan etterlate kunden uten primærsted når den har minst
 * ett sted.
 */

export type CustomerSiteRecord = {
  id: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  isPrimary: boolean;
};

export type CustomerSiteInput = {
  name?: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  isPrimary?: unknown;
};

const SITE_SELECT = {
  id: true,
  name: true,
  address: true,
  postalCode: true,
  city: true,
  isPrimary: true,
} as const;

function wantsPrimary(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

function siteFields(input: CustomerSiteInput) {
  return {
    name: cleanText(input.name, { maxLength: LIMITS.title }),
    address: cleanText(input.address, { maxLength: LIMITS.line }) || null,
    postalCode: cleanText(input.postalCode, { maxLength: LIMITS.short }) || null,
    city: cleanText(input.city, { maxLength: LIMITS.short }) || null,
  };
}

async function customerExists(customerId: string): Promise<boolean> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  return Boolean(customer);
}

async function setPrimaryInTx(
  tx: Prisma.TransactionClient,
  customerId: string,
  siteId: string,
) {
  await tx.customerSite.updateMany({
    where: { customerId },
    data: { isPrimary: false },
  });
  await tx.customerSite.update({
    where: { id: siteId },
    data: { isPrimary: true },
  });
}

/** Steder for kundekortet. Samme rekkefølge som kundeportalen bruker. */
export async function listCustomerSites(
  actor: ServiceActor,
  customerId: string,
): Promise<ServiceResult<CustomerSiteRecord[]>> {
  if (!can(actor, "customers.view")) return fail("forbidden");
  if (!(await customerExists(customerId))) return fail("not_found");

  const sites = await prisma.customerSite.findMany({
    where: { customerId },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    take: 200,
    select: SITE_SELECT,
  });
  return ok(sites);
}

/** Oppretter et sted fra kundekortet. */
export async function createCustomerSite(
  actor: ServiceActor,
  customerId: string,
  input: CustomerSiteInput,
): Promise<ServiceResult<CustomerSiteRecord>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");
  if (!(await customerExists(customerId))) return fail("not_found");

  const fields = siteFields(input);
  if (!fields.name) return fail("missing_fields");

  try {
    const site = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.customerSite.count({
        where: { customerId },
      });
      const isPrimary = existingCount === 0 || wantsPrimary(input.isPrimary);
      if (isPrimary) {
        await tx.customerSite.updateMany({
          where: { customerId },
          data: { isPrimary: false },
        });
      }
      const created = await tx.customerSite.create({
        data: {
          customerId,
          ...fields,
          isPrimary,
        },
        select: SITE_SELECT,
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Opprettet sted: ${fields.name}`,
        actor: toAuditActor(actor),
        metadata: { siteId: created.id, isPrimary },
      });
      return created;
    });
    return ok(site);
  } catch {
    return fail("conflict");
  }
}

/** Endrer navn/adresse på et sted som hører til kunden. */
export async function updateCustomerSite(
  actor: ServiceActor,
  customerId: string,
  input: CustomerSiteInput & { id?: unknown },
): Promise<ServiceResult<CustomerSiteRecord>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");
  const fields = siteFields(input);
  if (!fields.name) return fail("missing_fields");

  try {
    const site = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerSite.findFirst({
        where: { id, customerId },
        select: { id: true, isPrimary: true },
      });
      // Et sted som ikke tilhører kunden svarer som ukjent, slik at id-er fra
      // en annen kunde ikke kan brukes til å gjette seg til innhold.
      if (!existing) return null;

      if (wantsPrimary(input.isPrimary)) {
        await setPrimaryInTx(tx, customerId, id);
      }

      const updated = await tx.customerSite.update({
        where: { id },
        data: fields,
        select: SITE_SELECT,
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Endret sted: ${fields.name}`,
        actor: toAuditActor(actor),
        metadata: { siteId: id, isPrimary: updated.isPrimary },
      });
      return updated;
    });
    return site ? ok(site) : fail("not_found");
  } catch {
    return fail("conflict");
  }
}

/** Sletter et sted. Et primærsted erstattes av det eldste gjenstående. */
export async function deleteCustomerSite(
  actor: ServiceActor,
  customerId: string,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerSite.findFirst({
        where: { id, customerId },
        select: { id: true, name: true, isPrimary: true },
      });
      if (!existing) return false;

      await tx.customerSite.delete({ where: { id } });
      if (existing.isPrimary) {
        const next = await tx.customerSite.findFirst({
          where: { customerId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (next) {
          await tx.customerSite.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
        }
      }
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Slettet sted: ${existing.name}`,
        actor: toAuditActor(actor),
        metadata: { siteId: id, wasPrimary: existing.isPrimary },
      });
      return true;
    });
    return deleted ? ok(undefined) : fail("not_found");
  } catch {
    return fail("error");
  }
}

/** Setter et av kundens steder som primærsted. */
export async function setPrimaryCustomerSite(
  actor: ServiceActor,
  customerId: string,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  try {
    const done = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerSite.findFirst({
        where: { id, customerId },
        select: { id: true, name: true },
      });
      if (!existing) return false;
      await setPrimaryInTx(tx, customerId, id);
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Satte sted som primært: ${existing.name}`,
        actor: toAuditActor(actor),
        metadata: { siteId: id },
      });
      return true;
    });
    return done ? ok(undefined) : fail("not_found");
  } catch {
    return fail("error");
  }
}
