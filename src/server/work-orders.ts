// i18n-ignore-file: revisjonsloggen lagrer stabile, ferdig formaterte norske
// handlingsstrenger (med tittel/navn flettet inn). De oversettes ved visning i
// `src/lib/audit-actions.ts`; lagrede rader endres ikke.
import type { Prisma, WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyUser, notifyWorkOrderEvent } from "./notifications";
import { enqueueWorkOrderAssignedEmail } from "./email-outbox";
import { getDefaultDepartmentId } from "@/lib/departments";
import { hasPermission, type Permission } from "@/lib/permissions";
import { normalizeOrderNumber } from "@/lib/order-number";
import { generateWorkOrderReference } from "@/lib/work-order-reference";
import { addressHash, effectiveAddress, geocodeAddress } from "@/lib/geocode";
import {
  staffForDepartment,
  workOrderScope,
  type AccessUser,
} from "@/lib/access";
import { markdownToPlainText } from "@/lib/markdown";
import {
  addDaysUtc,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import { defaultVisitWindow } from "@/lib/visit-window";
import {
  LIMITS,
  cleanEmail,
  cleanMarkdown,
  cleanPhone,
  cleanStatus,
  cleanText,
} from "@/lib/sanitize";
import {
  commentCreateSchema,
  workOrderCreateSchema,
  workOrderDateSchema,
  workOrderStatusSchema,
  workOrderTemplateSchema,
  workOrderUpdateSchema,
} from "@/lib/schemas";
import { dateOnlySchema } from "@/lib/schemas/common";
import { transitionWorkOrderStatus } from "@/lib/work-order-status-action";
import { isClosedStatus, statusKeysByCategory } from "@/lib/work-order-status";
import {
  createDefaultVisit,
  DailyVisitConflictError,
  ensureDailyVisits,
  reconcileDailyVisits,
  recomputeWorkOrderSchedule,
} from "./visits";
import { startClock } from "./sla";
import { getDefaultWorkOrderStatus } from "./work-order-status-settings";
import { logServerError } from "@/lib/log-context";

/** Millisekunder i et døgn. Kalenderdatoer lagres som UTC-midnatt. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tjenestelaget for oppdrag.
 *
 * Sidene og rutebehandlerne skal ikke gjøre forretningslogikk selv: de sender
 * inn en eksplisitt aktør og rå verdier fra skjemaet, og får et resultat
 * tilbake. All autorisasjon skjer her, på serveren. En skjult knapp er aldri
 * eneste hinder – hver handling kontrollerer rettigheten og avdelingstilhørig-
 * heten på nytt, også når den kalles direkte.
 *
 * Skriving og revisjonslogg går alltid i samme transaksjon, slik at en endring
 * uten logg (eller en logg uten endring) ikke kan oppstå.
 */

export type WorkOrderError =
  | "ikke-tilgang"
  | "ikke-funnet"
  | "ugyldig-data"
  | "ugyldig-status"
  | "ingen-endring"
  | "ugyldig-sluttdato"
  | "sluttdato-for-startdato"
  | "workorder-locked"
  | "kunde-last"
  | "legal-hold"
  | "reason-required"
  | "duplikat-ordrenummer"
  | "avdeling"
  | "ukjent";

export type WorkOrderResult =
  | { ok: true }
  | { ok: false; error: WorkOrderError; detail?: string };

export type CreateWorkOrderResult =
  | { ok: true; id: string }
  | { ok: false; error: WorkOrderError; detail?: string };

export type AddContactResult =
  | { ok: true; contactId: string; customerId: string }
  | { ok: false; error: WorkOrderError };

export type UpdateDateError =
  | "ikke-autentisert"
  | "ingen-tilgang"
  | "ugyldig-dato"
  | "dato-mangler"
  | "ugyldig-sluttdato"
  | "sluttdato-for-startdato"
  | "ikke-funnet"
  | "legal-hold"
  | "ukjent";

export type UpdateDateResult =
  | { ok: true }
  | { ok: false; error: UpdateDateError; detail?: string };

type Actor = AccessUser | null;

type WorkOrderAccess = {
  id: string;
  title: string;
  departmentId: string;
  customerId: string | null;
  status: string;
  legalHold: boolean;
};

/**
 * Bevaringsplikt og lukket status fryser oppdragets metadata. Kommentarer er
 * bevisst ikke omfattet: de er additive og endrer ikke det som er bevart.
 */
function mutationBlocked(
  workOrder: { status: string; legalHold: boolean } | null | undefined,
): WorkOrderError | null {
  if (!workOrder) return "ikke-funnet";
  if (workOrder.legalHold) return "legal-hold";
  if (isClosedStatus(workOrder.status as WorkStatus)) return "workorder-locked";
  return null;
}

/** Sjekker bevaringsplikt/lås på nytt inne i transaksjonen. */
async function mutationBlockedInTransaction(
  tx: Prisma.TransactionClient,
  user: AccessUser,
  workOrderId: string,
): Promise<WorkOrderError | null> {
  const current = await tx.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    select: { status: true, legalHold: true },
  });
  return mutationBlocked(current);
}

/** Aktøren slik revisjonsloggen vil ha den. */
export function auditActor(user: AccessUser) {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

/**
 * Samme vakt som `requireWorkOrderAccess`, men med en eksplisitt aktør.
 *
 * Tjenesten får brukeren fra kallet i stedet for å hente økten på nytt. Da kan
 * autorisasjonen testes uten en innlogget nettleser, og reglene for avdeling
 * og kansellerte oppdrag ligger på ett sted i tjenestelaget.
 */
async function requireAccess(
  user: Actor,
  permission: Permission,
  workOrderId: string,
): Promise<WorkOrderAccess | null> {
  if (!user?.isActive || !hasPermission(user, permission)) return null;

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    select: {
      id: true,
      title: true,
      departmentId: true,
      customerId: true,
      status: true,
      legalHold: true,
    },
  });
  if (!workOrder) return null;

  // Kansellerte oppdrag er lukket for montørene. Kontor og administrator
  // trenger dem fortsatt for oppfølging og kunderelatert historikk.
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return null;
  }

  return workOrder;
}

/** Leser en id fra et skjema uten å stole på klienten. */
function rawId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

/** Er feilen brudd på en unik indeks, f.eks. ordrenummer per avdeling? */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Sjekker om et normalisert ordrenummer allerede finnes i avdelingen.
 * Unikhetsindeksen er siste skanse; denne sjekken gir en forståelig feil.
 */
async function orderNumberTaken(
  departmentId: string,
  orderNumberNormalized: string | null,
  exceptWorkOrderId?: string,
): Promise<boolean> {
  if (!orderNumberNormalized) return false;

  const count = await prisma.workOrder.count({
    where: {
      departmentId,
      orderNumberNormalized,
      ...(exceptWorkOrderId ? { id: { not: exceptWorkOrderId } } : {}),
    },
  });
  return count > 0;
}

/** Rydder en liste med tag-navn fra skjemaet. */
function cleanTagNames(values: unknown[]): string[] {
  return values
    .map((value) => cleanText(value, { maxLength: LIMITS.short }))
    .filter(Boolean);
}

type NormalizedSkillRequirements = {
  skillIds: string[];
  mandatorySkillIds: string[];
};

/**
 * Normaliserer kompetansekravene fra skjemaet. En kompetanse som er merket
 * påkrevd må også være valgt; ellers avvises hele skjemaet i stedet for at
 * kravet stille forsvinner.
 */
function normalizeSkillRequirements(input: {
  skillIds?: unknown[];
  mandatorySkillIds?: unknown[];
}): NormalizedSkillRequirements | null {
  const skillIds = Array.from(
    new Set((input.skillIds ?? []).map(rawId).filter(Boolean)),
  ).slice(0, 100);
  const mandatorySkillIds = Array.from(
    new Set((input.mandatorySkillIds ?? []).map(rawId).filter(Boolean)),
  ).slice(0, 100);
  if (mandatorySkillIds.some((id) => !skillIds.includes(id))) return null;
  return { skillIds, mandatorySkillIds };
}

/** Alle kompetanse-id-ene må finnes i katalogen før de lagres på oppdraget. */
async function skillsExist(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = await prisma.skill.findMany({
    where: { id: { in: ids } },
    select: { id: true },
    take: 100,
  });
  return found.length === ids.length;
}

/**
 * Kontrollerer datoperioden før hovedskjemaet. Da får brukeren en presis
 * melding om sluttdatoen i stedet for at en ugyldig periode blir stille
 * forkastet (eller oversatt til en generell «ugyldig data»).
 */
function dateRangeError(
  scheduledFor: string,
  scheduledTo: string,
): WorkOrderError | null {
  if (!scheduledTo) return null;

  const end = dateOnlySchema.safeParse(scheduledTo);
  if (!end.success) return "ugyldig-sluttdato";

  const start = scheduledFor ? dateOnlySchema.safeParse(scheduledFor) : null;
  if (start?.success && end.data < start.data) {
    return "sluttdato-for-startdato";
  }
  return null;
}

/** En visitt slik datorekonsolideringen trenger å se den. */
type VisitSummary = {
  id: string;
  status: string;
};

/** Legger brukeren til på alle visitene i samme transaksjon. */
async function addVisitTechnician(
  tx: Prisma.TransactionClient,
  visits: VisitSummary[],
  userId: string,
): Promise<void> {
  if (visits.length === 0) return;
  await tx.visitTechnician.createMany({
    data: visits.map((visit) => ({ visitId: visit.id, userId })),
    skipDuplicates: true,
  });
}

/** Fjerner brukeren fra alle visitene i samme transaksjon. */
async function removeVisitTechnician(
  tx: Prisma.TransactionClient,
  visits: VisitSummary[],
  userId: string,
): Promise<void> {
  if (visits.length === 0) return;
  await tx.visitTechnician.deleteMany({
    where: { visitId: { in: visits.map((visit) => visit.id) }, userId },
  });
}

/**
 * Speiler oppdragets montørliste nøyaktig på visitene. Oppdragslisten er
 * kontraktet mot resten av systemet; visitene skal aldri kunne peke på en
 * annen mengde folk.
 */
async function syncVisitTechniciansExact(
  tx: Prisma.TransactionClient,
  visits: VisitSummary[],
  technicianIds: string[],
): Promise<void> {
  if (visits.length === 0) return;
  const visitIds = visits.map((visit) => visit.id);

  await tx.visitTechnician.deleteMany({
    where: {
      visitId: { in: visitIds },
      ...(technicianIds.length > 0 ? { userId: { notIn: technicianIds } } : {}),
    },
  });

  if (technicianIds.length > 0) {
    await tx.visitTechnician.createMany({
      data: visits.flatMap((visit) =>
        technicianIds.map((userId) => ({ visitId: visit.id, userId })),
      ),
      skipDuplicates: true,
    });
  }
}

export type CreateWorkOrderInput = {
  title: unknown;
  orderNumber?: unknown;
  description: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  departmentId: unknown;
  customerId: unknown;
  contactId: unknown;
  siteId?: unknown;
  scheduledFor: unknown;
  scheduledTo: unknown;
  technicianIds: unknown[];
  templateIds: unknown[];
  tagNames: unknown[];
  skillIds?: unknown[];
  mandatorySkillIds?: unknown[];
};

export type CreateWorkOrderTransactionOptions = {
  /**
   * Kjør opprettelsen i en eksisterende transaksjon. Brukes av
   * `createExternalOrder`, slik at den eksterne referansen og oppdraget
   * committes eller rulles tilbake sammen.
   */
  tx?: Prisma.TransactionClient;
};

/**
 * Oppretter et oppdrag. Administrator kan velge avdeling; alle andre oppretter
 * i sin egen avdeling. Montører og maler må faktisk finnes i avdelingen, ellers
 * blir de ignorert.
 */
export async function createWorkOrder(
  user: Actor,
  input: CreateWorkOrderInput,
  options: CreateWorkOrderTransactionOptions = {},
): Promise<CreateWorkOrderResult> {
  if (!user?.isActive || !hasPermission(user, "workorders.create")) {
    return { ok: false, error: "ikke-tilgang" };
  }

  let departmentId: string | null = null;
  if (user.role === "ADMIN") {
    const requested = rawId(input.departmentId);
    if (requested) {
      const department = await prisma.department.findFirst({
        where: { id: requested, isActive: true },
        select: { id: true },
      });
      departmentId = department?.id ?? null;
    }
    departmentId = departmentId ?? (await getDefaultDepartmentId());
  } else {
    departmentId = user.departmentId;
  }

  if (!departmentId) return { ok: false, error: "avdeling" };

  const description = cleanMarkdown(input.description);
  const customerId = rawId(input.customerId);
  const contactId = rawId(input.contactId);

  // Kontaktpersonen må tilhøre den valgte kunden.
  let validContactId = contactId;
  if (contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.customerId !== customerId) validContactId = "";
  }

  // Stedet må tilhøre den valgte kunden. Et internt oppdrag uten kunde kan
  // ikke peke på en kundes sted.
  const requestedSiteId = rawId(input.siteId);
  const site = requestedSiteId
    ? await prisma.customerSite.findFirst({
        where: { id: requestedSiteId, customerId: customerId || "__none__" },
        select: {
          id: true,
          name: true,
          address: true,
          postalCode: true,
          city: true,
        },
      })
    : null;
  if (requestedSiteId && !site) return { ok: false, error: "ugyldig-data" };
  const siteId = site?.id ?? null;

  const requestedTechnicianIds = input.technicianIds
    .map(rawId)
    .filter(Boolean);

  // Montører som ikke hører til oppdragets avdeling skal ikke kunne tildeles.
  const allowedTechnicians = requestedTechnicianIds.length
    ? await prisma.user.findMany({
        where: {
          id: { in: requestedTechnicianIds },
          ...staffForDepartment(departmentId),
        },
        select: { id: true },
        take: 100,
      })
    : [];
  const technicianIds = allowedTechnicians.map((technician) => technician.id);

  const scheduledForInput = rawId(input.scheduledFor);
  const scheduledToInput = rawId(input.scheduledTo);
  const rangeError = dateRangeError(scheduledForInput, scheduledToInput);
  if (rangeError) return { ok: false, error: rangeError };

  const skillRequirements = normalizeSkillRequirements(input);
  if (!skillRequirements) return { ok: false, error: "ugyldig-data" };
  if (!(await skillsExist(skillRequirements.skillIds))) {
    return { ok: false, error: "ugyldig-data" };
  }

  const parsed = workOrderCreateSchema.safeParse({
    title: cleanText(input.title, { maxLength: LIMITS.title }),
    orderNumber: cleanText(input.orderNumber, { maxLength: LIMITS.line }),
    description,
    address: cleanText(input.address, { maxLength: LIMITS.line }),
    postalCode: cleanText(input.postalCode, { maxLength: LIMITS.short }),
    city: cleanText(input.city, { maxLength: LIMITS.line }),
    departmentId,
    customerId,
    contactId: validContactId,
    scheduledFor: scheduledForInput,
    scheduledTo: scheduledToInput,
    technicianIds,
    templateIds: input.templateIds.map(rawId).filter(Boolean),
    tagNames: cleanTagNames(input.tagNames),
    skillIds: skillRequirements.skillIds,
    mandatorySkillIds: skillRequirements.mandatorySkillIds,
  });
  if (!parsed.success) return { ok: false, error: "ugyldig-data" };

  const scheduledFor = parseDateOnly(parsed.data.scheduledFor);
  if (!scheduledFor) return { ok: false, error: "ugyldig-data" };
  const parsedEnd = parseDateOnly(parsed.data.scheduledTo);
  const scheduledTo = parsedEnd && parsedEnd > scheduledFor ? parsedEnd : null;
  const title = parsed.data.title;
  const orderNumber = parsed.data.orderNumber || null;
  const orderNumberNormalized = normalizeOrderNumber(orderNumber);

  if (await orderNumberTaken(departmentId, orderNumberNormalized)) {
    return { ok: false, error: "duplikat-ordrenummer" };
  }

  const customerAddress = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: { address: true, postalCode: true, city: true },
      })
    : null;
  const address = effectiveAddress({
    address: parsed.data.address,
    postalCode: parsed.data.postalCode,
    city: parsed.data.city,
    customer: site ?? customerAddress,
  });
  const geoHash = addressHash(address.query);
  const coordinates = geoHash ? await geocodeAddress(address.query, address) : null;

  const defaultStatus = await getDefaultWorkOrderStatus();

  let id: string;
  try {
    const run = <T>(
      fn: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> =>
      options.tx ? fn(options.tx) : prisma.$transaction(fn);

    id = await run(async (tx) => {
      const newWorkOrder = await tx.workOrder.create({
        data: {
          title,
          reference: generateWorkOrderReference(),
          orderNumber,
          orderNumberNormalized,
          description: description || "",
          address: parsed.data.address || null,
          postalCode: parsed.data.postalCode || null,
          city: parsed.data.city || null,
          geoAddressHash: geoHash,
          latitude: coordinates?.lat ?? null,
          longitude: coordinates?.lng ?? null,
          departmentId,
          customerId: customerId || undefined,
          contactId: parsed.data.contactId || undefined,
          siteId: siteId || undefined,
          scheduledFor,
          scheduledTo,
          creatorName: user.name || user.email || "Kontor",
          status: defaultStatus,
          technicians: {
            connect: technicianIds.map((id) => ({ id })),
          },
          templates: {
            connect: parsed.data.templateIds.map((id) => ({ id })),
          },
          tags: {
            connectOrCreate: parsed.data.tagNames.map((name) => ({
              where: { name },
              create: { name },
            })),
          },
          skillRequirements:
            parsed.data.skillIds.length > 0
              ? {
                  create: parsed.data.skillIds.map((skillId) => ({
                    skillId,
                    mandatory: parsed.data.mandatorySkillIds.includes(skillId),
                  })),
                }
              : undefined,
        },
        select: { id: true },
      });

      // Et datofestet oppdrag har én intern arbeidsøkt per kalenderdag. Visiten
      // er den tildelbare tidsblokken; `scheduledFor`/`scheduledTo` avledes av
      // visitene og holdes i takt i samme transaksjon.
      await ensureDailyVisits(tx, {
        workOrderId: newWorkOrder.id,
        scheduledFor,
        scheduledTo,
        technicianIds,
      });
      await recomputeWorkOrderSchedule(tx, newWorkOrder.id);

      // Aktive avtaler og avdelingens SLA-policy starter klokken med en gang.
      // Uten policy opprettes ingen klokke.
      await startClock(tx, newWorkOrder.id);

      await audit(tx, {
        entityType: "WorkOrder",
        entityId: newWorkOrder.id,
        action: `Kontoret opprettet nytt oppdrag: ${title}`,
        actor: auditActor(user),
        metadata: {
          customerId: customerId || null,
          ...(siteId ? { siteId } : {}),
          orderNumber,
          orderNumberNormalized,
        },
      });

      return newWorkOrder.id;
    });
  } catch (dbError) {
    // En samtidig opprettelse kan vinne kappløpet selv om forhåndssjekken
    // passerte. Unikhetsindeksen avviser duplikatet, og brukeren får samme
    // forståelige feil som ved forhåndssjekken.
    if (isUniqueViolation(dbError)) {
      return { ok: false, error: "duplikat-ordrenummer" };
    }
    await logServerError("Databasefeil ved opprettelse av oppdrag", dbError, {
      customerId,
    });
    throw new Error("Kunne ikke opprette oppdrag");
  }

  return { ok: true, id };
}

export type UpdateWorkOrderInput = {
  title: unknown;
  orderNumber?: unknown;
  description: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  departmentId: unknown;
  customerId: unknown;
  contactId: unknown;
  siteId?: unknown;
  scheduledFor: unknown;
  scheduledTo: unknown;
  technicianIds: unknown[];
  tagNames: unknown[];
  skillIds?: unknown[];
  mandatorySkillIds?: unknown[];
};

/** Redigerer tittel, kunde, dato, avdeling, montører og tags på et oppdrag. */
export async function updateWorkOrder(
  user: Actor,
  workOrderId: string,
  input: UpdateWorkOrderInput,
): Promise<WorkOrderResult> {
  if (!user?.isActive || !hasPermission(user, "workorders.edit")) {
    return { ok: false, error: "ikke-tilgang" };
  }

  const currentWorkOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    select: {
      id: true,
      departmentId: true,
      customerId: true,
      siteId: true,
      status: true,
      legalHold: true,
      orderNumber: true,
      orderNumberNormalized: true,
      address: true,
      postalCode: true,
      city: true,
      latitude: true,
      longitude: true,
      geoAddressHash: true,
      scheduledFor: true,
      scheduledTo: true,
      // Datoflytting på oppdragsnivå kan bare konsolidere én visitt.
      visits: { select: { id: true, status: true }, orderBy: { sequence: "asc" } },
      // Bevis og bestillinger hører til den opprinnelige kunden. Rapportene
      // hentes uten filter, slik at også mykt slettede signerte rapporter
      // blokkerer en kundeflytting.
      reports: { select: { id: true }, take: 1 },
      bookingRequest: { select: { id: true } },
    },
  });
  if (!currentWorkOrder) return { ok: false, error: "ikke-tilgang" };

  // Bevaringsplikten fryser alle metadataendringer. Et fullført eller
  // kansellert oppdrag er låst historikk.
  if (currentWorkOrder.legalHold) {
    return { ok: false, error: "legal-hold" };
  }
  // Et fullført oppdrag er låst. Rapporter kan være låst uten at oppdraget er
  // fullført; det skal ikke hindre redigering.
  if (isClosedStatus(currentWorkOrder.status as WorkStatus)) {
    return { ok: false, error: "workorder-locked" };
  }

  // Administrator kan flytte oppdraget til en annen aktiv avdeling.
  let departmentId = currentWorkOrder.departmentId;
  if (user.role === "ADMIN") {
    const requested = rawId(input.departmentId);
    if (requested) {
      const department = await prisma.department.findFirst({
        where: { id: requested, isActive: true },
        select: { id: true },
      });
      if (!department) return { ok: false, error: "ikke-tilgang" };
      departmentId = department.id;
    }
  }

  const technicianIds = input.technicianIds.map(rawId).filter(Boolean);
  const tagNames = cleanTagNames(input.tagNames);

  // Bare ansatte i oppdragets avdeling kan tildeles.
  const allowedTechnicians = technicianIds.length
    ? await prisma.user.findMany({
        where: { id: { in: technicianIds }, ...staffForDepartment(departmentId) },
        select: { id: true },
        take: 100,
      })
    : [];
  const validTechnicianIds = allowedTechnicians.map((technician) => technician.id);

  const scheduledForInput = rawId(input.scheduledFor);
  const scheduledToInput = rawId(input.scheduledTo);
  const rangeError = dateRangeError(scheduledForInput, scheduledToInput);
  if (rangeError) return { ok: false, error: rangeError };

  const skillRequirements = normalizeSkillRequirements(input);
  if (!skillRequirements) return { ok: false, error: "ugyldig-data" };
  if (!(await skillsExist(skillRequirements.skillIds))) {
    return { ok: false, error: "ugyldig-data" };
  }

  const parsed = workOrderUpdateSchema.safeParse({
    id: workOrderId,
    title: cleanText(input.title, { maxLength: LIMITS.title }),
    orderNumber: cleanText(input.orderNumber, { maxLength: LIMITS.line }),
    description: cleanMarkdown(input.description),
    address: cleanText(input.address, { maxLength: LIMITS.line }),
    postalCode: cleanText(input.postalCode, { maxLength: LIMITS.short }),
    city: cleanText(input.city, { maxLength: LIMITS.line }),
    departmentId,
    customerId: rawId(input.customerId),
    contactId: rawId(input.contactId),
    siteId: rawId(input.siteId),
    scheduledFor: scheduledForInput,
    scheduledTo: scheduledToInput,
    technicianIds: validTechnicianIds,
    tagNames,
    skillIds: skillRequirements.skillIds,
    mandatorySkillIds: skillRequirements.mandatorySkillIds,
  });
  if (!parsed.success) return { ok: false, error: "ugyldig-data" };

  const {
    title,
    orderNumber,
    description,
    address: explicitAddress,
    postalCode,
    city,
    customerId,
    contactId,
    siteId: requestedSiteId,
    scheduledFor,
    scheduledTo,
  } = parsed.data;

  // Kunden kan ikke flyttes når oppdraget allerede har rapporter eller en
  // bestilling. Rapportene kan være mykt slettet, men signert innhold er
  // fortsatt bevis; bestillingen tilhører den opprinnelige kunden. Da avvises
  // hele redigeringen, og opplastingsradene beholder sin opprinnelige eier.
  const previousCustomerId = currentWorkOrder.customerId ?? null;
  const nextCustomerId = customerId || null;
  const customerChanged = nextCustomerId !== previousCustomerId;
  if (
    customerChanged &&
    ((currentWorkOrder.reports?.length ?? 0) > 0 ||
      Boolean(currentWorkOrder.bookingRequest))
  ) {
    return { ok: false, error: "kunde-last" };
  }

  const orderNumberValue = orderNumber || null;
  const orderNumberNormalized = normalizeOrderNumber(orderNumberValue);
  const scheduledForDate = scheduledFor ? parseDateOnly(scheduledFor) : null;
  const scheduledToDate = scheduledTo ? parseDateOnly(scheduledTo) : null;
  const nextScheduledTo =
    scheduledToDate && scheduledForDate && scheduledToDate > scheduledForDate
      ? scheduledToDate
      : null;
  const datesChanged =
    toDateOnly(currentWorkOrder.scheduledFor) !== toDateOnly(scheduledForDate) ||
    toDateOnly(currentWorkOrder.scheduledTo) !== toDateOnly(nextScheduledTo);

  // Ordrenummeret er unikt per avdeling. Sjekk før skriving, slik at brukeren
  // får en tydelig feil i stedet for en generell databasefeil.
  if (
    await orderNumberTaken(departmentId, orderNumberNormalized, workOrderId)
  ) {
    return { ok: false, error: "duplikat-ordrenummer" };
  }

  // Kontaktpersonen må tilhøre den valgte kunden; ellers tømmes feltet.
  let validContactId: string | undefined = contactId;
  if (validContactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: validContactId },
    });
    if (!contact || contact.customerId !== customerId) validContactId = undefined;
  }

  // Stedet må tilhøre kunden oppdraget skal ligge hos. Når feltet ikke er
  // sendt i det hele tatt beholder vi dagens sted; en tom verdi fjerner det.
  // En kundeflytting uten nytt sted rydder bort det gamle stedet.
  const siteFieldProvided = Object.prototype.hasOwnProperty.call(
    input,
    "siteId",
  );
  const candidateSiteId = siteFieldProvided
    ? requestedSiteId
    : customerChanged
      ? undefined
      : (currentWorkOrder.siteId ?? undefined);
  const site = candidateSiteId
    ? await prisma.customerSite.findFirst({
        where: { id: candidateSiteId, customerId: nextCustomerId || "__none__" },
        select: {
          id: true,
          name: true,
          address: true,
          postalCode: true,
          city: true,
        },
      })
    : null;
  if (candidateSiteId && !site) {
    return { ok: false, error: "ugyldig-data" };
  }
  const nextSiteId = site?.id ?? null;

  const customerAddress = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: { address: true, postalCode: true, city: true },
      })
    : null;
  const effective = effectiveAddress({
    address: explicitAddress,
    postalCode,
    city,
    customer: site ?? customerAddress,
  });
  const geoHash = addressHash(effective.query);
  const coordinates =
    geoHash && geoHash !== currentWorkOrder.geoAddressHash
      ? await geocodeAddress(effective.query, effective)
      : currentWorkOrder.latitude != null && currentWorkOrder.longitude != null
        ? { lat: currentWorkOrder.latitude, lng: currentWorkOrder.longitude }
        : null;

  try {
    const blocked = await prisma.$transaction(async (tx) => {
      const finalGuard = await mutationBlockedInTransaction(
        tx,
        user,
        workOrderId,
      );
      if (finalGuard) return finalGuard;

      let visits = await tx.visit.findMany({
        where: { workOrderId },
        select: { id: true, status: true },
        orderBy: { sequence: "asc" },
      });

      await tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          title,
          orderNumber: orderNumberValue,
          orderNumberNormalized,
          description,
          address: explicitAddress || null,
          postalCode: postalCode || null,
          city: city || null,
          geoAddressHash: geoHash,
          latitude: coordinates?.lat ?? null,
          longitude: coordinates?.lng ?? null,
          departmentId,
          // Tom kunde betyr et internt oppdrag, ikke en uendret kunde.
          customerId: nextCustomerId,
          contactId: validContactId || null,
          siteId: nextSiteId,
          scheduledFor: scheduledForDate,
          scheduledTo: nextScheduledTo,
          technicians: { set: validTechnicianIds.map((id) => ({ id })) },
          tags: {
            set: [],
            connectOrCreate: tagNames.map((name) => ({
              where: { name },
              create: { name },
            })),
          },
        },
      });

      // Kompetansekravene erstattes i samme transaksjon. En feil senere i
      // transaksjonen ruller da både oppdraget og kravene tilbake.
      await tx.workOrderSkill.deleteMany({ where: { workOrderId } });
      if (parsed.data.skillIds.length > 0) {
        await tx.workOrderSkill.createMany({
          data: parsed.data.skillIds.map((skillId) => ({
            workOrderId,
            skillId,
            mandatory: parsed.data.mandatorySkillIds.includes(skillId),
          })),
        });
      }

      if (datesChanged) {
        // Arbeidsdagene avstemmes mot den nye perioden. Eksisterende dager
        // flyttes aldri; manglende dager legges til, og bare rene planlagte
        // dager fram i tid kan fjernes. Loggede dager gir konflikt.
        await reconcileDailyVisits(tx, {
          workOrderId,
          scheduledFor: scheduledForDate,
          scheduledTo: nextScheduledTo,
          technicianIds: validTechnicianIds,
        });
        visits = await tx.visit.findMany({
          where: { workOrderId },
          select: { id: true, status: true },
          orderBy: { sequence: "asc" },
        });
        await recomputeWorkOrderSchedule(tx, workOrderId);
      }

      // Oppdragslisten og visitene skal alltid vise samme montører.
      await syncVisitTechniciansExact(tx, visits, validTechnicianIds);

      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `Oppdaterte oppdraget: ${title}`,
        actor: auditActor(user),
        metadata: {
          orderNumber: {
            from: currentWorkOrder.orderNumber,
            to: orderNumberValue,
          },
          orderNumberNormalized,
          siteId: {
            from: currentWorkOrder.siteId ?? null,
            to: nextSiteId,
          },
          // Bare id-er, aldri kundedata. Bare med når kunden faktisk endres.
          ...(customerChanged
            ? {
                customerId: {
                  from: previousCustomerId,
                  to: nextCustomerId,
                },
              }
            : {}),
        },
      });

      // Filene til oppdraget arver avdeling og kunde fra oppdraget. Flyttes
      // oppdraget, må ACL-en på opplastingsradene følge med i samme transaksjon;
      // ellers ville brukere i den gamle avdelingen fortsatt kunne lese filene.
      // En kundeflytting med rapporter/bestilling er allerede avvist over, så
      // her finnes det ingen signert historikk som kan havne hos feil kunde.
      await tx.upload.updateMany({
        where: { ownerType: "WORK_ORDER", ownerId: workOrderId },
        data: { departmentId, customerId: nextCustomerId },
      });
      return null;
    });
    if (blocked) return { ok: false, error: blocked };
  } catch (error) {
    if (error instanceof DailyVisitConflictError) {
      return { ok: false, error: "ugyldig-data", detail: error.detail };
    }
    if (isUniqueViolation(error)) {
      return { ok: false, error: "duplikat-ordrenummer" };
    }
    throw error;
  }

  return { ok: true };
}

export type StatusContext = "office" | "field";

/**
 * Bytter status på et oppdrag.
 *
 * Bare COMPLETED og CANCELLED er lukkede tilstander. Alle åpne statuser kan
 * byttes fritt til en annen åpen status, eller lukkes som fullført/kansellert.
 * En låst rapport (`Report.isLocked`) påvirker ikke oppdragets livssyklus; den
 * låser bare redigering av selve rapporten. Bare når oppdraget er fullført
 * eller kansellert kreves en grunn, og bare administrator kan gjenåpne det.
 * Kansellering krever fortsatt `workorders.edit`.
 */
export async function changeWorkOrderStatus(
  user: Actor,
  workOrderId: string,
  rawStatus: unknown,
  context: StatusContext,
  rawReason?: unknown,
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, "workorders.update", workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };

  const parsed = workOrderStatusSchema.safeParse({
    status: cleanStatus(rawStatus),
  });
  if (!parsed.success) return { ok: false, error: "ugyldig-data" };
  const status = parsed.data.status as WorkStatus;
  const from = access.status as WorkStatus;

  const fromClosed = isClosedStatus(from);
  const reason = cleanText(rawReason, { maxLength: 1000 });

  // Bare lukkede oppdrag krever grunn. Åpne statuser kan velges fritt,
  // uavhengig av om oppdraget har en låst rapport.
  if (fromClosed) {
    if (user.role !== "ADMIN") return { ok: false, error: "workorder-locked" };
    if (!reason) return { ok: false, error: "reason-required" };
  }

  // Kansellering er en kontorhandling.
  if (status === "CANCELLED" && !hasPermission(user, "workorders.edit")) {
    return { ok: false, error: "ugyldig-status" };
  }

  const action =
    context === "field"
      ? `Montør endret status til: ${status}`
      : fromClosed
        ? `Administrator gjenåpnet oppdraget: ${from} → ${status}. Grunn: ${reason}`
        : `${user.role === "TECHNICIAN" ? "Montør" : "Kontoret"} endret status til: ${status}`;

  const result = await transitionWorkOrderStatus({
    workOrderId,
    from,
    to: status,
    isAdmin: user.role === "ADMIN",
    // Åpne statuser kan byttes fritt, også når en rapport er låst. Rapporten
    // og oppdraget har hver sin livssyklus. Bare den bevisste
    // administratorgjenåpningen av et lukket oppdrag overstyrer reglene –
    // den krever allerede en grunn over.
    force: fromClosed,
    actor: auditActor(user),
    action,
    ...(fromClosed
      ? { metadata: { from, to: status, reason, reopened: true } }
      : {}),
  });

  if (result.ok && status === "CANCELLED") {
    try {
      await notifyWorkOrderEvent(
        workOrderId,
        "CANCELLED",
        "Oppdraget er kansellert",
        access.title
          ? `«${access.title}» er kansellert.`
          : "Oppdraget er kansellert.",
        `/oppdrag/${workOrderId}`,
        `cancelled:${workOrderId}`,
      );
    } catch {
      // Varsling er best effort og skal ikke velte statusendringen.
    }
  }

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Flytter et oppdrag i kalenderen. Brukes av PATCH-ruten, som oversetter
 * resultatet til HTTP-status og de samme norske meldingene som før.
 */
export async function updateWorkOrderDate(
  user: Actor,
  workOrderId: string,
  body: unknown,
): Promise<UpdateDateResult> {
  if (!user) return { ok: false, error: "ikke-autentisert" };
  if (!user.isActive || !hasPermission(user, "workorders.update")) {
    return { ok: false, error: "ingen-tilgang" };
  }

  const existing = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    select: {
      status: true,
      legalHold: true,
      title: true,
      scheduledFor: true,
      scheduledTo: true,
    },
  });
  if (!existing) return { ok: false, error: "ikke-funnet" };
  if (existing.legalHold) return { ok: false, error: "legal-hold" };
  if (isClosedStatus(existing.status as WorkStatus)) {
    return { ok: false, error: "ikke-funnet" };
  }

  const parsed = workOrderDateSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "ugyldig-dato" };

  const scheduledFor = parseDateOnly(parsed.data.newDate);
  if (!scheduledFor) return { ok: false, error: "dato-mangler" };

  // `newEnd` er siste inkluderte dag. Når feltet mangler helt (for eksempel når
  // kalenderen bare drar i startdatoen) beholder et flerdagsoppdrag lengden sin.
  // Sendes `newEnd` eksplisitt som tom verdi, blir oppdraget éndags.
  const hasEnd =
    typeof body === "object" &&
    body !== null &&
    Object.prototype.hasOwnProperty.call(body, "newEnd");
  let scheduledTo: Date | null = null;

  if (parsed.data.newEnd) {
    const parsedEnd = parseDateOnly(parsed.data.newEnd);
    if (!parsedEnd) return { ok: false, error: "ugyldig-sluttdato" };
    if (parsedEnd < scheduledFor) {
      return { ok: false, error: "sluttdato-for-startdato" };
    }
    scheduledTo = parsedEnd > scheduledFor ? parsedEnd : null;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.workOrder.findFirst({
        where: { id: workOrderId, ...workOrderScope(user) },
        select: {
          id: true,
          status: true,
          legalHold: true,
          scheduledFor: true,
          scheduledTo: true,
          technicians: { select: { id: true } },
        },
      });
      if (!before) return { count: 0 };
      if (before.legalHold) return { legalHold: true } as const;
      if (isClosedStatus(before.status as WorkStatus)) return { count: 0 };

      // Mangler `newEnd`, flyttes hele intervallet: samme antall dager som før.
      let nextScheduledTo = scheduledTo;
      if (!hasEnd && before.scheduledFor && before.scheduledTo) {
        const durationDays = Math.max(
          0,
          Math.round(
            (before.scheduledTo.getTime() - before.scheduledFor.getTime()) / DAY_MS,
          ),
        );
        nextScheduledTo = durationDays > 0 ? addDaysUtc(scheduledFor, durationDays) : null;
      }
      if (nextScheduledTo && nextScheduledTo < scheduledFor) {
        return { count: 0, invalidRange: true } as const;
      }

      // Avstem før skriving, slik at en konflikt gir en tydelig feil uten
      // delvise endringer. Transaksjonen ruller uansett alt tilbake.
      await reconcileDailyVisits(tx, {
        workOrderId: before.id,
        scheduledFor,
        scheduledTo: nextScheduledTo,
        technicianIds: (before.technicians ?? []).map(
          (technician) => technician.id,
        ),
      });

      const result = await tx.workOrder.updateMany({
        where: {
          id: before.id,
          legalHold: false,
          status: { notIn: statusKeysByCategory("CLOSED") },
        },
        data: { scheduledFor, scheduledTo: nextScheduledTo },
      });

      if (result.count > 0) {
        await recomputeWorkOrderSchedule(tx, before.id);

        await audit(tx, {
          entityType: "WorkOrder",
          entityId: before.id,
          action: `Endret dato til ${toDateOnly(scheduledFor)}${
            nextScheduledTo ? `–${toDateOnly(nextScheduledTo)}` : ""
          }`,
          actor: auditActor(user),
          metadata: {
            from: toDateOnly(before.scheduledFor),
            to: toDateOnly(nextScheduledTo ?? scheduledFor),
          },
        });
      }

      return result;
    });

    if ("invalidRange" in updated && updated.invalidRange) {
      return { ok: false, error: "sluttdato-for-startdato" };
    }
    if ("legalHold" in updated && updated.legalHold) {
      return { ok: false, error: "legal-hold" };
    }
    if (updated.count === 0) return { ok: false, error: "ikke-funnet" };
    try {
      await notifyWorkOrderEvent(
        workOrderId,
        "DATE_CHANGED",
        "Oppdraget er flyttet",
        existing.title
          ? `«${existing.title}» er flyttet. Ny dato: ${toDateOnly(scheduledFor)}`
          : `Ny dato: ${toDateOnly(scheduledFor)}`,
        `/oppdrag/${workOrderId}`,
        `date:${workOrderId}:${toDateOnly(scheduledFor)}`,
      );
    } catch {
      // Varsling er best effort.
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof DailyVisitConflictError) {
      return { ok: false, error: "ugyldig-dato", detail: error.detail };
    }
    return { ok: false, error: "ukjent" };
  }
}

/**
 * Knytter en sjekklistemal til oppdraget. Kontoret krever `workorders.edit`,
 * feltportalen `workorders.update` – samme handling, ulik inngang.
 */
export async function addTemplate(
  user: Actor,
  workOrderId: string,
  rawTemplateId: unknown,
  permission: "workorders.edit" | "workorders.update",
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, permission, workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };
  if (access.legalHold) return { ok: false, error: "legal-hold" };
  if (isClosedStatus(access.status as WorkStatus)) return { ok: false, error: "workorder-locked" };

  const parsed = workOrderTemplateSchema.safeParse({
    templateId: rawId(rawTemplateId),
  });
  if (!parsed.success) return { ok: false, error: "ugyldig-data" };
  const templateId = parsed.data.templateId;

  const blocked = await prisma.$transaction(async (tx) => {
    const finalGuard = await mutationBlockedInTransaction(tx, user, workOrderId);
    if (finalGuard) return finalGuard;

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: { templates: { connect: { id: templateId } } },
    });
    // Sjekklisten er en del av oppdraget, så hendelsen følger oppdragets id.
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: "La til en sjekkliste på oppdraget",
      actor: auditActor(user),
      metadata: { templateId },
    });
    return null;
  });
  if (blocked) return { ok: false, error: blocked };

  return { ok: true };
}

/** Legger til en kommentar på oppdraget. */
export async function addComment(
  user: Actor,
  workOrderId: string,
  rawContent: unknown,
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, "workorders.update", workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };

  const parsed = commentCreateSchema.safeParse({
    content: cleanMarkdown(rawContent),
  });
  if (!parsed.success) return { ok: false, error: "ugyldig-data" };
  const content = parsed.data.content;

  await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        content,
        workOrderId,
        authorName: user.name || user.email || "Montør",
      },
    });
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: `La til kommentar: "${markdownToPlainText(content).slice(0, 30)}..."`,
      actor: auditActor(user),
      metadata: { commentId: comment.id },
    });
  });

  return { ok: true };
}

/** Erstatter oppdragets tags med listen fra skjemaet. */
export async function setTags(
  user: Actor,
  workOrderId: string,
  rawTagNames: unknown[],
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, "workorders.edit", workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };
  if (access.legalHold) return { ok: false, error: "legal-hold" };
  if (isClosedStatus(access.status as WorkStatus)) return { ok: false, error: "workorder-locked" };

  const tagNames = cleanTagNames(rawTagNames);

  const blocked = await prisma.$transaction(async (tx) => {
    const finalGuard = await mutationBlockedInTransaction(tx, user, workOrderId);
    if (finalGuard) return finalGuard;

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        tags: {
          set: [],
          connectOrCreate: tagNames.map((name) => ({
            where: { name },
            create: { name },
          })),
        },
      },
    });
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: `Oppdaterte tags: ${tagNames.join(", ") || "(ingen)"}`,
      actor: auditActor(user),
      metadata: { tags: tagNames },
    });
    return null;
  });
  if (blocked) return { ok: false, error: blocked };

  return { ok: true };
}

/** Velger en kontaktperson som hører til oppdragets kunde. */
export async function setContact(
  user: Actor,
  workOrderId: string,
  rawContactId: unknown,
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, "workorders.edit", workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };
  if (access.legalHold) return { ok: false, error: "legal-hold" };
  if (isClosedStatus(access.status as WorkStatus)) return { ok: false, error: "workorder-locked" };
  if (!hasPermission(user, "customers.manage")) {
    return { ok: false, error: "ikke-tilgang" };
  }

  const contactId = rawId(rawContactId);
  const customerId = access.customerId;

  let contactName: string | null = null;
  if (contactId) {
    // Kontaktpersonen må tilhøre kunden oppdraget gjelder.
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.customerId !== customerId) {
      return { ok: false, error: "ugyldig-data" };
    }
    contactName = contact.name;
  }

  const blocked = await prisma.$transaction(async (tx) => {
    const finalGuard = await mutationBlockedInTransaction(tx, user, workOrderId);
    if (finalGuard) return finalGuard;

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: { contactId: contactId || null },
    });
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: contactName
        ? `Valgte kontaktperson: ${contactName}`
        : "Fjernet kontaktpersonen fra oppdraget",
      actor: auditActor(user),
      metadata: contactId ? { contactId } : undefined,
    });
    return null;
  });
  if (blocked) return { ok: false, error: blocked };

  return { ok: true };
}

/** Oppretter en ny kontaktperson på kunden og velger den på oppdraget. */
export async function addContactToCustomer(
  user: Actor,
  workOrderId: string,
  input: {
    name: unknown;
    email: unknown;
    phone: unknown;
    role: unknown;
  },
): Promise<AddContactResult> {
  const access = await requireAccess(user, "workorders.edit", workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };
  if (access.legalHold) return { ok: false, error: "legal-hold" };
  if (isClosedStatus(access.status as WorkStatus)) return { ok: false, error: "workorder-locked" };
  if (!hasPermission(user, "customers.manage")) {
    return { ok: false, error: "ikke-tilgang" };
  }

  const customerId = access.customerId;
  if (!customerId) return { ok: false, error: "ugyldig-data" };

  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const email = cleanEmail(input.email);
  const phone = cleanPhone(input.phone);
  const role = cleanText(input.role, { maxLength: LIMITS.short });
  if (!name) return { ok: false, error: "ugyldig-data" };

  const result = await prisma.$transaction(async (tx) => {
    const finalGuard = await mutationBlockedInTransaction(tx, user, workOrderId);
    if (finalGuard) return { blocked: finalGuard } as const;

    const contact = await tx.contact.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        role: role || null,
        customerId,
      },
      select: { id: true },
    });

    // Den nye kontaktpersonen blir valgt på oppdraget med en gang.
    await tx.workOrder.update({
      where: { id: workOrderId },
      data: { contactId: contact.id },
    });

    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: `La til kontaktperson: ${name}`,
      actor: auditActor(user),
      metadata: { contactId: contact.id, customerId },
    });

    return { contactId: contact.id } as const;
  });

  if ("blocked" in result) {
    return { ok: false, error: result.blocked ?? "ukjent" };
  }
  return { ok: true, contactId: result.contactId, customerId };
}

type TechnicianChange = {
  permission: Permission;
  mode: "connect" | "disconnect";
  action: (name: string | null) => string;
};

/**
 * Tildeler eller fjerner en ansatt. Bare ansatte i oppdragets avdeling kan
 * endres, slik at en id fra en annen avdeling ikke kan brukes direkte.
 */
async function changeTechnician(
  user: Actor,
  workOrderId: string,
  rawUserId: unknown,
  options: TechnicianChange,
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, options.permission, workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };
  if (access.legalHold) return { ok: false, error: "legal-hold" };
  if (isClosedStatus(access.status as WorkStatus)) {
    return { ok: false, error: "workorder-locked" };
  }

  const userId = rawId(rawUserId);
  if (!userId) return { ok: false, error: "ugyldig-data" };

  const target = await prisma.user.findFirst({
    where: { id: userId, ...staffForDepartment(access.departmentId) },
    select: { id: true, name: true, email: true, locale: true },
  });
  if (!target) return { ok: false, error: "ugyldig-data" };

  const blocked = await prisma.$transaction(async (tx) => {
    const finalGuard = await mutationBlockedInTransaction(tx, user, workOrderId);
    if (finalGuard) return finalGuard;

    const visits = await tx.visit.findMany({
      where: { workOrderId },
      select: { id: true, status: true },
      orderBy: { sequence: "asc" },
    });

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        technicians:
          options.mode === "connect"
            ? { connect: { id: userId } }
            : { disconnect: { id: userId } },
      },
    });

    // Oppdraget og visitene skal alltid ha samme montører. Endringen skjer i
    // samme transaksjon som selve tildelingen.
    if (options.mode === "connect") {
      await addVisitTechnician(tx, visits, userId);
    } else {
      await removeVisitTechnician(tx, visits, userId);
    }

    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: options.action(target.name),
      actor: auditActor(user),
      metadata:
        options.mode === "connect" ? { technicianId: userId } : { userId },
    });
    return null;
  });
  if (blocked) return { ok: false, error: blocked };

  if (options.mode === "connect") {
    try {
      await notifyUser({
        userId,
        type: "ASSIGNMENT",
        title: "Du er tildelt et oppdrag",
        body: access.title
          ? `«${access.title}» er tildelt deg.`
          : "Et oppdrag er tildelt deg.",
        href: `/mine-oppdrag/${workOrderId}`,
        dedupeKey: `assignment:${workOrderId}:${userId}`,
      });
    } catch {
      // Varsling er best effort.
    }

    await enqueueWorkOrderAssignedEmail({
      workOrderId,
      userId,
      title: access.title ?? "",
      email: target.email,
      locale: target.locale,
    });
  }

  return { ok: true };
}

/** Kontorets tildeling av montør. */
export function assignTechnician(
  user: Actor,
  workOrderId: string,
  rawTechnicianId: unknown,
): Promise<WorkOrderResult> {
  return changeTechnician(user, workOrderId, rawTechnicianId, {
    permission: "workorders.assign",
    mode: "connect",
    action: (name) => `La til ${name} som montør`,
  });
}

/** Kontorets fjerning av montør. */
export function unassignTechnician(
  user: Actor,
  workOrderId: string,
  rawTechnicianId: unknown,
): Promise<WorkOrderResult> {
  return changeTechnician(user, workOrderId, rawTechnicianId, {
    permission: "workorders.assign",
    mode: "disconnect",
    action: (name) => `Fjernet ${name || "montør"} fra oppdraget`,
  });
}

/**
 * Flytter én montør fra en kolonne til en annen i dispatch-tavla.
 *
 * Kilden fjernes og målet legges til i samme transaksjon, slik at et avbrudd
 * aldri kan ende med at oppdraget verken har gammel eller ny montør. Tom kilde
 * betyr «uten montør», og tomt mål betyr «fjern kilden». Ved tomt mål fjernes
 * bare den angitte montøren – aldri alle montørene på oppdraget.
 */
export async function moveTechnician(
  user: Actor,
  workOrderId: string,
  rawFromTechnicianId: unknown,
  rawToTechnicianId: unknown,
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, "workorders.assign", workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };
  if (access.legalHold) return { ok: false, error: "legal-hold" };
  if (isClosedStatus(access.status as WorkStatus)) {
    return { ok: false, error: "workorder-locked" };
  }

  const fromId = rawId(rawFromTechnicianId);
  const toId = rawId(rawToTechnicianId);
  // Klienten kan sende kolonnenavnet «unassigned» i stedet for tom id.
  const sourceTechnicianId = fromId === "unassigned" ? "" : fromId;
  const targetTechnicianId = toId === "unassigned" ? "" : toId;
  if (!sourceTechnicianId && !targetTechnicianId) {
    return { ok: false, error: "ugyldig-data" };
  }
  if (
    sourceTechnicianId &&
    targetTechnicianId &&
    sourceTechnicianId === targetTechnicianId
  ) {
    return { ok: false, error: "ingen-endring" };
  }

  const target = targetTechnicianId
    ? await prisma.user.findFirst({
        where: {
          id: targetTechnicianId,
          ...staffForDepartment(access.departmentId),
        },
        select: { id: true, name: true, email: true, locale: true },
      })
    : null;
  if (targetTechnicianId && !target) {
    return { ok: false, error: "ugyldig-data" };
  }

  const source = sourceTechnicianId
    ? await prisma.user.findFirst({
        where: { id: sourceTechnicianId },
        select: { id: true, name: true },
      })
    : null;

  const blocked = await prisma.$transaction(async (tx): Promise<WorkOrderError | null> => {
    const current = await tx.workOrder.findFirst({
      where: { id: workOrderId, ...workOrderScope(user) },
      select: {
        status: true,
        legalHold: true,
        technicians: { select: { id: true } },
        visits: { select: { id: true, status: true }, orderBy: { sequence: "asc" } },
      },
    });
    const finalGuard = mutationBlocked(current);
    if (finalGuard) return finalGuard;

    const assigned = new Set(
      current?.technicians.map((technician) => technician.id) ?? [],
    );
    // En utdatert tavle skal ikke kunne fjerne feil person, eller «flytte»
    // noe som allerede står i målkolonnen.
    if (sourceTechnicianId && !assigned.has(sourceTechnicianId)) {
      return "ingen-endring";
    }
    if (targetTechnicianId && assigned.has(targetTechnicianId)) {
      return "ingen-endring";
    }

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        technicians: {
          ...(sourceTechnicianId
            ? { disconnect: { id: sourceTechnicianId } }
            : {}),
          ...(targetTechnicianId
            ? { connect: { id: targetTechnicianId } }
            : {}),
        },
      },
    });

    const visits = current?.visits ?? [];
    if (sourceTechnicianId) {
      await removeVisitTechnician(tx, visits, sourceTechnicianId);
    }
    if (targetTechnicianId) {
      await addVisitTechnician(tx, visits, targetTechnicianId);
    }

    const action = targetTechnicianId
      ? sourceTechnicianId
        ? `Flyttet ${source?.name || "montør"} til ${target?.name || "montør"}`
        : `La til ${target?.name || "montør"} som montør`
      : `Fjernet ${source?.name || "montør"} fra oppdraget`;

    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action,
      actor: auditActor(user),
      metadata: {
        fromTechnicianId: sourceTechnicianId || null,
        technicianId: targetTechnicianId || null,
      },
    });
    return null;
  });
  if (blocked) return { ok: false, error: blocked };

  if (targetTechnicianId && target) {
    try {
      await notifyUser({
        userId: target.id,
        type: "ASSIGNMENT",
        title: "Du er tildelt et oppdrag",
        body: access.title
          ? `«${access.title}» er tildelt deg.`
          : "Et oppdrag er tildelt deg.",
        href: `/mine-oppdrag/${workOrderId}`,
        dedupeKey: `assignment:${workOrderId}:${target.id}`,
      });
    } catch {
      // Varsling er best effort.
    }

    await enqueueWorkOrderAssignedEmail({
      workOrderId,
      userId: target.id,
      title: access.title ?? "",
      email: target.email,
      locale: target.locale,
    });
  }

  return { ok: true };
}

/** Feltportalens tillegging av kollega eller kontorperson. */
export function addTechnician(
  user: Actor,
  workOrderId: string,
  rawUserId: unknown,
): Promise<WorkOrderResult> {
  return changeTechnician(user, workOrderId, rawUserId, {
    permission: "workorders.update",
    mode: "connect",
    action: (name) => `La til ${name || "bruker"} på oppdraget`,
  });
}

/** Feltportalens fjerning av kollega eller seg selv. */
export function removeTechnician(
  user: Actor,
  workOrderId: string,
  rawUserId: unknown,
): Promise<WorkOrderResult> {
  return changeTechnician(user, workOrderId, rawUserId, {
    permission: "workorders.update",
    mode: "disconnect",
    action: (name) => `Fjernet ${name || "bruker"} fra oppdraget`,
  });
}

/**
 * Kloner et oppdrag til et nytt, redigerbart oppdrag med samme data.
 * Rapporter, kommentarer, vedlegg og historikk følger ikke med.
 */
export async function cloneWorkOrder(
  user: Actor,
  workOrderId: string,
): Promise<CreateWorkOrderResult> {
  if (!user?.isActive || !hasPermission(user, "workorders.create")) {
    return { ok: false, error: "ikke-tilgang" };
  }

  const source = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    include: {
      technicians: { select: { id: true } },
      templates: { select: { id: true } },
      tags: { select: { name: true } },
      skillRequirements: { select: { skillId: true, mandatory: true } },
      visits: {
        select: {
          sequence: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          notes: true,
          technicians: { select: { userId: true } },
        },
        orderBy: { sequence: "asc" },
      },
    },
  });
  if (!source) return { ok: false, error: "ikke-funnet" };

  const cloneDefaultStatus = await getDefaultWorkOrderStatus();

  try {
    const id = await prisma.$transaction(async (tx) => {
      const created = await tx.workOrder.create({
        data: {
          title: source.title,
          reference: generateWorkOrderReference(),
          // Ordrenummeret er unikt per avdeling og hører til det opprinnelige
          // oppdraget. En klone starter derfor uten ordrenummer, og kontoret
          // setter et nytt hvis klonen skal ha et eksternt nummer.
          orderNumber: null,
          orderNumberNormalized: null,
          description: source.description,
          departmentId: source.departmentId,
          customerId: source.customerId,
          contactId: source.contactId,
          productId: source.productId,
          scheduledFor: source.scheduledFor,
          scheduledTo: source.scheduledTo,
          creatorName: user.name || user.email || "Kontor",
          status: cloneDefaultStatus,
          technicians: { connect: source.technicians.map((tech) => ({ id: tech.id })) },
          templates: { connect: source.templates.map((template) => ({ id: template.id })) },
          tags: {
            connectOrCreate: source.tags.map((tag) => ({
              where: { name: tag.name },
              create: { name: tag.name },
            })),
          },
          skillRequirements:
            (source.skillRequirements ?? []).length > 0
              ? {
                  create: source.skillRequirements.map((entry) => ({
                    skillId: entry.skillId,
                    mandatory: entry.mandatory,
                  })),
                }
              : undefined,
        },
        select: { id: true },
      });

      const sourceVisits = source.visits ?? [];
      if (sourceVisits.length > 0) {
        // Tidsblokkene kopieres med sine absolutte tider, slik at en klone av
        // et flervisitsoppdrag beholder planen. Klonen er en ny, åpen sak, så
        // statusen starter på PLANNED.
        for (const visit of sourceVisits) {
          await tx.visit.create({
            data: {
              workOrderId: created.id,
              sequence: visit.sequence,
              startsAt: visit.startsAt,
              endsAt: visit.endsAt,
              allDay: visit.allDay,
              notes: visit.notes,
              status: "PLANNED",
              technicians: {
                create: visit.technicians.map((technician) => ({
                  userId: technician.userId,
                })),
              },
            },
          });
        }
      } else if (source.scheduledFor) {
        // Eldre oppdrag kan mangle visitt selv om de har dato. Da lager
        // klonen en standard firetimersblokk, med samme montører som oppdraget.
        const window = defaultVisitWindow(source.scheduledFor);
        await createDefaultVisit(tx, {
          workOrderId: created.id,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          allDay: false,
          technicianIds: source.technicians.map((technician) => technician.id),
        });
      }

      if (sourceVisits.length > 0 || source.scheduledFor) {
        await recomputeWorkOrderSchedule(tx, created.id);
      }

      await audit(tx, {
        entityType: "WorkOrder",
        entityId: created.id,
        action: `Klonet oppdraget «${source.title}» til nytt oppdrag`,
        actor: auditActor(user),
        metadata: {
          sourceWorkOrderId: source.id,
          customerId: source.customerId,
          orderNumberCleared: source.orderNumber ?? null,
        },
      });

      return created.id;
    });

    return { ok: true, id };
  } catch (error) {
    await logServerError("Databasefeil ved kloning av oppdrag", error, { workOrderId });
    return { ok: false, error: "ukjent" };
  }
}

/**
 * Slår bevaringsplikt på eller av for et oppdrag og alle rapportene på det.
 *
 * Bare administrator kan gjøre dette. Bevaringsplikten må ligge både på
 * oppdraget og på hver rapport, fordi retensjonsjobben vurderer dem hver for
 * seg. Endringene og revisjonsloggen skrives i samme transaksjon.
 *
 * Å slå på bevaringsplikt smitter til alle rapportene. Å slå den av krever en
 * grunn, og rører bevisst **ikke** rapportenes egne `legalHold`-flagg: en
 * rapport kan ha fått bevaringsplikt uavhengig av oppdraget, og en avslått
 * bryter skal aldri frigjøre bevis i det stille. Rapporter frigjøres enkeltvis
 * med `setReportLegalHold(..., false, grunn)`, og hver frigjøring logges med
 * rapport-id.
 */
export async function setWorkOrderLegalHold(
  user: Actor,
  workOrderId: string,
  rawHold: unknown,
  rawReason?: unknown,
): Promise<WorkOrderResult> {
  if (!user?.isActive || user.role !== "ADMIN") {
    return { ok: false, error: "ikke-tilgang" };
  }

  const id = rawId(workOrderId);
  if (!id) return { ok: false, error: "ugyldig-data" };

  // Skjemaet sender «true»/«false»; tjenesten godtar også boolske verdier.
  const hold =
    rawHold === true ||
    rawHold === "true" ||
    rawHold === "on" ||
    rawHold === "1";

  const reason = cleanText(rawReason, { maxLength: 1000 });
  // Frigjøring av bevis er en bevisst handling som skal kunne forklares.
  if (!hold && !reason) return { ok: false, error: "reason-required" };

  const target = await prisma.workOrder.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      legalHold: true,
      reports: { select: { id: true, legalHold: true } },
    },
  });
  if (!target) return { ok: false, error: "ikke-funnet" };

  const retainedReportIds = target.reports
    .filter((report) => report.legalHold)
    .map((report) => report.id);

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id }, data: { legalHold: hold } });

    if (hold) {
      // Bevaringsplikt på oppdraget skal gjelde hele beviskjeden.
      await tx.report.updateMany({
        where: { workOrderId: id },
        data: { legalHold: true },
      });
    }
    // Ved avslag oppdateres ingen rapporter. Se dokumentasjonen over.

    await audit(tx, {
      entityType: "WorkOrder",
      entityId: id,
      action: hold
        ? `Slo på bevaringsplikt for oppdraget «${target.title}»`
        : `Slo av bevaringsplikt for oppdraget «${target.title}» (rapporter beholder sin egen bevaringsplikt)`,
      actor: auditActor(user),
      metadata: {
        legalHold: hold,
        reportCount: target.reports.length,
        ...(!hold ? { reason, retainedReportIds } : {}),
      },
    });
  });

  return { ok: true };
}

/**
 * Slår bevaringsplikt på eller av for én enkelt rapport. Brukes når en rapport
 * har fått bevaringsplikt uavhengig av oppdraget, eller når en administrator
 * bevisst vil frigjøre én rapport etter at oppdragets bryter er slått av.
 *
 * Frigjøring krever en grunn og logges med rapport-id. Selve rapportinnholdet
 * røres ikke.
 */
export async function setReportLegalHold(
  user: Actor,
  workOrderId: string,
  rawReportId: unknown,
  rawHold: unknown,
  rawReason?: unknown,
): Promise<WorkOrderResult> {
  if (!user?.isActive || user.role !== "ADMIN") {
    return { ok: false, error: "ikke-tilgang" };
  }

  const workOrder = rawId(workOrderId);
  const reportId = rawId(rawReportId);
  if (!workOrder || !reportId) return { ok: false, error: "ugyldig-data" };

  const hold =
    rawHold === true ||
    rawHold === "true" ||
    rawHold === "on" ||
    rawHold === "1";

  const reason = cleanText(rawReason, { maxLength: 1000 });
  if (!hold && !reason) return { ok: false, error: "reason-required" };

  const report = await prisma.report.findFirst({
    where: { id: reportId, workOrderId: workOrder, deletedAt: null },
    select: { id: true, name: true, templateTitle: true, legalHold: true },
  });
  if (!report) return { ok: false, error: "ikke-funnet" };

  await prisma.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: report.id },
      data: { legalHold: hold },
    });

    await audit(tx, {
      entityType: "Report",
      entityId: report.id,
      action: hold
        ? `Slo på bevaringsplikt for rapporten «${report.name || report.templateTitle || report.id}»`
        : `Slo av bevaringsplikt for rapporten «${report.name || report.templateTitle || report.id}»`,
      actor: auditActor(user),
      metadata: {
        legalHold: hold,
        workOrderId: workOrder,
        reportId: report.id,
        ...(!hold ? { reason } : {}),
      },
    });
  });

  return { ok: true };
}

/** Myksletter oppdraget. Rapporter, kommentarer og vedlegg beholdes. */
export async function deleteWorkOrder(
  user: Actor,
  workOrderId: string,
): Promise<WorkOrderResult> {
  const access = await requireAccess(user, "workorders.delete", workOrderId);
  if (!access || !user) return { ok: false, error: "ikke-tilgang" };

  const target = await prisma.workOrder.findUnique({
    where: { id: access.id },
    select: {
      title: true,
      deletedAt: true,
      legalHold: true,
      status: true,
      customer: { select: { name: true } },
      reports: { select: { legalHold: true } },
    },
  });
  if (!target) return { ok: false, error: "ikke-funnet" };
  if (target.deletedAt) return { ok: false, error: "ikke-funnet" };

  // Bevaringsplikt på oppdraget eller på en av rapportene stopper sletting.
  if (target.legalHold || target.reports.some((report) => report.legalHold)) {
    return { ok: false, error: "legal-hold" };
  }

  // Fullførte og kansellerte oppdrag er avsluttet historikk. Bare
  // administrator kan slette dem; knappen skjules i UI, men regelen håndheves
  // her slik at den også gjelder direkte kall.
  if (
    (target.status === "COMPLETED" || target.status === "CANCELLED") &&
    user.role !== "ADMIN"
  ) {
    return { ok: false, error: "workorder-locked" };
  }

  const deletedBy = user.name || user.email || user.id;

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id: access.id },
      data: { deletedAt: new Date(), deletedBy },
    });
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: access.id,
      action: `Slettet oppdraget «${target.title}»${
        target.customer?.name ? ` (${target.customer.name})` : ""
      } (myk sletting – kan gjenopprettes)`,
      actor: auditActor(user),
      metadata: { softDeleted: true, legalHold: target.legalHold },
    });
  });

  // Rapporter, revisjoner, kommentarer og vedlegg blir liggende. Filer
  // frigjøres først når bevaringsperioden er utløpt og oppdraget hard-slettes.
  return { ok: true };
}

/** Gjenoppretter et mykt slettet oppdrag. Bare administrator kan gjøre dette. */
export async function restoreWorkOrder(
  user: Actor,
  workOrderId: string,
): Promise<WorkOrderResult> {
  if (!user?.isActive || user.role !== "ADMIN") {
    return { ok: false, error: "ikke-tilgang" };
  }

  const id = rawId(workOrderId);
  if (!id) return { ok: false, error: "ugyldig-data" };

  const target = await prisma.workOrder.findUnique({
    where: { id },
    select: { id: true, title: true, deletedAt: true },
  });
  if (!target) return { ok: false, error: "ikke-funnet" };
  if (!target.deletedAt) return { ok: false, error: "ugyldig-data" };

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id: target.id },
      data: { deletedAt: null, deletedBy: null },
    });
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: target.id,
      action: `Gjenopprettet oppdraget «${target.title}»`,
      actor: auditActor(user),
    });
  });

  return { ok: true };
}
