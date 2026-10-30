// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning, på samme måte som de øvrige tjenestene.
import crypto from "node:crypto";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { toDateOnly } from "@/lib/dates";
import { canReadUpload } from "@/lib/upload-access";
import type { AccessUser } from "@/lib/access";
import { cleanText, LIMITS } from "@/lib/sanitize";
import { trackingLinkExpiresAt } from "@/server/tracking";
import { hashReviewToken } from "@/server/reviews";
import {
  getMessageThread,
  listMessageThreads,
  sendThreadMessage,
} from "./messaging";
import { fail, ok, toAuditActor, type ServiceActor, type ServiceResult } from "./actor";
import {
  requirePortalCapability,
  resolvePortalAccess,
  type PortalCapability,
} from "./portal-access";

/** Alle portallister er sidestørrelser, ikke stille radtak. */
export const PORTAL_LIST_PAGE_SIZE = 20;

function pageWindow(page: number, total: number, pageSize = PORTAL_LIST_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page)), totalPages);
  return {
    page: current,
    totalPages,
    skip: (current - 1) * pageSize,
    take: pageSize,
  };
}

async function portal(actor: ServiceActor, capability?: PortalCapability) {
  return capability
    ? requirePortalCapability(actor, capability)
    : resolvePortalAccess(actor);
}

// ---------------------------------------------------------------------------
// Dokumenter
// ---------------------------------------------------------------------------

export type PortalDocument = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  url: string;
};

export type PortalDocumentPage = {
  items: PortalDocument[];
  total: number;
  page: number;
  totalPages: number;
};

/**
 * Kundens egne dokumenter. Bare `Upload`-rader som er eid av kunden er med;
 * hver rad kontrolleres i tillegg med `canReadUpload`, slik at en fremmed rad
 * aldri kan lekke gjennom en bred spørring. Rapporter og oppdragsvedlegg har
 * egne ruter.
 */
export async function getPortalDocuments(
  actor: ServiceActor,
  options: { page?: number } = {},
): Promise<ServiceResult<PortalDocumentPage>> {
  const access = await portal(actor, "canViewDocuments");
  if (!access.ok) return access;

  const where = {
    ownerType: "CUSTOMER",
    customerId: access.data.customerId,
  };
  const total = await prisma.upload.count({ where });
  const window = pageWindow(options.page ?? 1, total);
  const rows = await prisma.upload.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      storedName: true,
      originalName: true,
      mimeType: true,
      size: true,
      createdAt: true,
      ownerType: true,
      ownerId: true,
      departmentId: true,
      customerId: true,
      uploadedById: true,
    },
  });

  const items = rows
    .filter((row) => canReadUpload(actor as unknown as AccessUser, row))
    .map((row) => ({
      id: row.id,
      name: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      uploadedAt: row.createdAt.toISOString(),
      url: `/uploads/${row.storedName}`,
    }));

  return ok({
    items,
    total,
    page: window.page,
    totalPages: window.totalPages,
  });
}

// ---------------------------------------------------------------------------
// Utstyr
// ---------------------------------------------------------------------------

export type PortalEquipment = {
  id: string;
  model: string;
  serialNumber: string | null;
  location: string | null;
  siteName: string | null;
  status: string;
  criticality: number;
  categoryName: string | null;
  warrantyUntil: string | null;
  installDate: string | null;
  meterUnit: string | null;
  lastReading: { value: number; readAt: string } | null;
  activePlanCount: number;
};

export type PortalEquipmentPage = {
  items: PortalEquipment[];
  total: number;
  page: number;
  totalPages: number;
};

export async function getPortalEquipment(
  actor: ServiceActor,
  options: { page?: number } = {},
): Promise<ServiceResult<PortalEquipmentPage>> {
  const access = await portal(actor, "canViewEquipment");
  if (!access.ok) return access;

  const where = { customerId: access.data.customerId };
  const total = await prisma.product.count({ where });
  const window = pageWindow(options.page ?? 1, total);
  const rows = await prisma.product.findMany({
    where,
    orderBy: [{ model: "asc" }, { id: "asc" }],
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      model: true,
      serialNumber: true,
      location: true,
      status: true,
      criticality: true,
      warrantyUntil: true,
      installDate: true,
      meterUnit: true,
      site: { select: { name: true } },
      category: { select: { name: true } },
      meterReadings: {
        orderBy: { readAt: "desc" },
        take: 1,
        select: { value: true, readAt: true },
      },
      _count: { select: { maintenancePlans: { where: { isActive: true } } } },
    },
  });

  return ok({
    total,
    page: window.page,
    totalPages: window.totalPages,
    items: rows.map((row) => ({
      id: row.id,
      model: row.model,
      serialNumber: row.serialNumber,
      location: row.location,
      siteName: row.site?.name ?? null,
      status: row.status,
      criticality: row.criticality,
      categoryName: row.category?.name ?? null,
      warrantyUntil: row.warrantyUntil ? toDateOnly(row.warrantyUntil) : null,
      installDate: row.installDate ? toDateOnly(row.installDate) : null,
      meterUnit: row.meterUnit,
      lastReading: row.meterReadings[0]
        ? {
            value: Number(row.meterReadings[0].value),
            readAt: row.meterReadings[0].readAt.toISOString(),
          }
        : null,
      activePlanCount: row._count.maintenancePlans,
    })),
  });
}

// ---------------------------------------------------------------------------
// Avtaler
// ---------------------------------------------------------------------------

export type PortalContractLine = {
  id: string;
  scope: string;
  productModel: string | null;
  visitsPerYear: number | null;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
};

export type PortalContract = {
  id: string;
  title: string;
  contractNumber: string | null;
  status: string;
  isActive: boolean;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
  nextServiceDate: string;
  renewalMode: string;
  slaPolicyName: string | null;
  lines: PortalContractLine[];
};

export type PortalContractPage = {
  items: PortalContract[];
  total: number;
  page: number;
  totalPages: number;
};

export async function getPortalContracts(
  actor: ServiceActor,
  options: { page?: number } = {},
): Promise<ServiceResult<PortalContractPage>> {
  const access = await portal(actor, "canViewContracts");
  if (!access.ok) return access;

  const where = { customerId: access.data.customerId };
  const total = await prisma.contract.count({ where });
  const window = pageWindow(options.page ?? 1, total);
  const rows = await prisma.contract.findMany({
    where,
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      title: true,
      contractNumber: true,
      status: true,
      isActive: true,
      intervalMonths: true,
      startDate: true,
      endDate: true,
      nextServiceDate: true,
      renewalMode: true,
      slaPolicy: {
        select: { name: true, responseMinutes: true, resolutionMinutes: true },
      },
      lines: {
        orderBy: { id: "asc" },
        take: 10,
        select: {
          id: true,
          scope: true,
          visitsPerYear: true,
          responseMinutes: true,
          resolutionMinutes: true,
          product: { select: { model: true } },
        },
      },
    },
  });

  return ok({
    total,
    page: window.page,
    totalPages: window.totalPages,
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      contractNumber: row.contractNumber,
      status: row.status,
      isActive: row.isActive,
      intervalMonths: row.intervalMonths,
      startDate: toDateOnly(row.startDate),
      endDate: row.endDate ? toDateOnly(row.endDate) : null,
      nextServiceDate: toDateOnly(row.nextServiceDate),
      renewalMode: row.renewalMode,
      slaPolicyName: row.slaPolicy?.name ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        scope: line.scope,
        productModel: line.product?.model ?? null,
        visitsPerYear: line.visitsPerYear,
        responseMinutes: line.responseMinutes,
        resolutionMinutes: line.resolutionMinutes,
      })),
    })),
  });
}

// ---------------------------------------------------------------------------
// Besøkstidslinje
// ---------------------------------------------------------------------------

export type PortalVisit = {
  id: string;
  workOrderId: string;
  workOrderTitle: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  technicians: string[];
  siteName: string | null;
  address: string | null;
  canTrack: boolean;
  hasActiveTracking: boolean;
  reviewSubmitted: boolean;
  canReview: boolean;
};

export type PortalVisitTimeline = {
  upcoming: PortalVisit[];
  past: PortalVisit[];
};

function portalVisitSelect(now: Date) {
  return {
    id: true,
    startsAt: true,
    endsAt: true,
    allDay: true,
    status: true,
    technicians: {
      take: 5,
      select: { user: { select: { name: true } } },
    },
    trackingLinks: {
      where: { revokedAt: null, expiresAt: { gt: now } },
      take: 1,
      select: { id: true },
    },
    reviews: { take: 1, select: { submittedAt: true } },
    workOrder: {
      select: {
        id: true,
        title: true,
        address: true,
        postalCode: true,
        city: true,
        customer: { select: { address: true, postalCode: true, city: true } },
        site: {
          select: { name: true, address: true, postalCode: true, city: true },
        },
        department: { select: { trackingEnabled: true } },
      },
    },
  } as const;
}

type PortalVisitRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  technicians: Array<{ user: { name: string | null } }>;
  trackingLinks: Array<{ id: string }>;
  reviews: Array<{ submittedAt: Date | null }>;
  workOrder: {
    id: string;
    title: string;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    customer: { address: string | null; postalCode: string | null; city: string | null } | null;
    site: {
      name: string;
      address: string | null;
      postalCode: string | null;
      city: string | null;
    } | null;
    department: { trackingEnabled: boolean } | null;
  };
};

function visitView(row: PortalVisitRow): PortalVisit {
  const site = row.workOrder.site;
  const addressSource = site ?? row.workOrder.customer;
  const address = [
    site?.address ?? row.workOrder.address ?? addressSource?.address,
    site?.postalCode ?? row.workOrder.postalCode ?? addressSource?.postalCode,
    site?.city ?? row.workOrder.city ?? addressSource?.city,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: row.id,
    workOrderId: row.workOrder.id,
    workOrderTitle: row.workOrder.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    status: row.status,
    technicians: row.technicians
      .map((rowTech) => rowTech.user.name)
      .filter((name): name is string => Boolean(name)),
    siteName: site?.name ?? null,
    address: address || null,
    canTrack:
      Boolean(row.workOrder.department?.trackingEnabled) &&
      (row.status === "EN_ROUTE" || row.status === "ON_SITE"),
    hasActiveTracking: row.trackingLinks.length > 0,
    reviewSubmitted: Boolean(row.reviews[0]?.submittedAt),
    canReview: row.status === "DONE" && !row.reviews[0]?.submittedAt,
  };
}

/** Kommende og siste besøk, med status, sted og sporingsmulighet. */
export async function getPortalVisitTimeline(
  actor: ServiceActor,
  options: { upcomingLimit?: number; pastLimit?: number } = {},
): Promise<ServiceResult<PortalVisitTimeline>> {
  const access = await portal(actor);
  if (!access.ok) return access;

  const now = new Date();
  const upcomingLimit = Math.min(Math.max(1, options.upcomingLimit ?? 20), 50);
  const pastLimit = Math.min(Math.max(1, options.pastLimit ?? 20), 50);
  const customerWhere = {
    workOrder: { customerId: access.data.customerId, deletedAt: null },
  };

  const [upcoming, past] = await Promise.all([
    prisma.visit.findMany({
      where: {
        ...customerWhere,
        status: { in: ["PLANNED", "ASSIGNED", "EN_ROUTE", "ON_SITE"] },
        endsAt: { gte: now },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: upcomingLimit,
      select: portalVisitSelect(now),
    }),
    prisma.visit.findMany({
      where: {
        ...customerWhere,
        OR: [{ endsAt: { lt: now } }, { status: { in: ["DONE", "CANCELLED"] } }],
      },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      take: pastLimit,
      select: portalVisitSelect(now),
    }),
  ]);

  return ok({
    upcoming: upcoming.map((row) => visitView(row as PortalVisitRow)),
    past: past.map((row) => visitView(row as PortalVisitRow)),
  });
}

function newPortalToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Oppretter en offentlig sporingslenke for et aktivt besøk som tilhører
 * kunden. Selve tokenet returneres bare én gang; databasen lagrer hashen.
 */
export async function createPortalTrackingLink(
  actor: ServiceActor,
  visitId: unknown,
): Promise<ServiceResult<{ token: string; expiresAt: Date }>> {
  const access = await portal(actor);
  if (!access.ok) return access;
  const id = cleanText(visitId, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const visit = await prisma.visit.findFirst({
    where: {
      id,
      workOrder: { customerId: access.data.customerId, deletedAt: null },
    },
    select: {
      id: true,
      workOrderId: true,
      endsAt: true,
      status: true,
      workOrder: {
        select: {
          title: true,
          department: { select: { trackingEnabled: true } },
        },
      },
    },
  });
  if (!visit) return fail("not_found");
  if (visit.status !== "EN_ROUTE" && visit.status !== "ON_SITE") {
    return fail("conflict");
  }
  if (!visit.workOrder.department.trackingEnabled) return fail("forbidden");
  const expiresAt = trackingLinkExpiresAt(visit.endsAt);
  if (expiresAt.getTime() <= Date.now()) return fail("invalid");

  const token = newPortalToken();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.$transaction(async (tx) => {
    await tx.trackingLink.updateMany({
      where: { visitId: visit.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.trackingLink.create({
      data: {
        tokenHash,
        workOrderId: visit.workOrderId,
        visitId: visit.id,
        expiresAt,
      },
    });
    await audit(tx, {
      entityType: "Visit",
      entityId: visit.id,
      action: `Kunden opprettet sporingslenke for ${visit.workOrder.title}`,
      actor: toAuditActor(actor),
      metadata: { workOrderId: visit.workOrderId },
    });
  });

  return ok({ token, expiresAt });
}

/** Ber om omtale for et fullført besøk. Idempotent per besøk. */
export async function requestPortalReview(
  actor: ServiceActor,
  visitId: unknown,
): Promise<ServiceResult<{ token: string | null; submitted: boolean }>> {
  const access = await portal(actor);
  if (!access.ok) return access;
  const id = cleanText(visitId, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const visit = await prisma.visit.findFirst({
    where: {
      id,
      workOrder: { customerId: access.data.customerId, deletedAt: null },
    },
    select: { id: true, workOrderId: true, status: true, workOrder: { select: { title: true } } },
  });
  if (!visit) return fail("not_found");
  if (visit.status !== "DONE") return fail("conflict");

  const token = newPortalToken();
  const tokenHash = hashReviewToken(token);
  const review = await prisma.$transaction(async (tx) => {
    const saved = await tx.review.upsert({
      where: { visitId: visit.id },
      update: {},
      create: {
        workOrderId: visit.workOrderId,
        visitId: visit.id,
        tokenHash,
        requestedAt: new Date(),
      },
      select: { id: true, tokenHash: true, submittedAt: true },
    });
    if (saved.tokenHash === tokenHash) {
      await audit(tx, {
        entityType: "Review",
        entityId: saved.id,
        action: `Kunden ba om å gi omtale for ${visit.workOrder.title}`,
        actor: toAuditActor(actor),
        metadata: { workOrderId: visit.workOrderId, visitId: visit.id },
      });
    }
    return saved;
  });

  return ok({
    token: review.tokenHash === tokenHash && !review.submittedAt ? token : null,
    submitted: Boolean(review.submittedAt),
  });
}

// ---------------------------------------------------------------------------
// Meldinger
// ---------------------------------------------------------------------------

export async function getPortalMessageThreads(
  actor: ServiceActor,
  options: { page?: number } = {},
) {
  const access = await portal(actor);
  if (!access.ok) return access;
  return listMessageThreads(actor, {
    page: options.page,
    customerId: access.data.customerId,
  });
}

export async function getPortalMessageThread(
  actor: ServiceActor,
  threadId: unknown,
  options: { markRead?: boolean } = {},
) {
  const access = await portal(actor);
  if (!access.ok) return access;
  return getMessageThread(actor, threadId, options);
}

export async function sendPortalMessage(
  actor: ServiceActor,
  threadId: unknown,
  body: unknown,
) {
  const access = await portal(actor);
  if (!access.ok) return access;
  return sendThreadMessage(actor, threadId, body);
}

// ---------------------------------------------------------------------------
// Steder
// ---------------------------------------------------------------------------

export type PortalSite = {
  id: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  isPrimary: boolean;
};

/** Kundens egne steder, avgrenset til aktørens kunde. */
export async function getPortalSites(
  actor: ServiceActor,
): Promise<ServiceResult<PortalSite[]>> {
  const access = await portal(actor);
  if (!access.ok) return access;
  const sites = await prisma.customerSite.findMany({
    where: { customerId: access.data.customerId },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    take: 50,
    select: {
      id: true,
      name: true,
      address: true,
      postalCode: true,
      city: true,
      isPrimary: true,
    },
  });
  return ok(sites);
}

const SITE_NAME_MAX = LIMITS.title;
const SITE_LINE_MAX = LIMITS.line;

/**
 * Oppretter et nytt sted for kunden. Kunden kan aldri velge en annen
 * `customerId`, og navnet må være unikt innenfor kunden.
 */
export async function createPortalSite(
  actor: ServiceActor,
  input: {
    name?: unknown;
    address?: unknown;
    postalCode?: unknown;
    city?: unknown;
  },
): Promise<ServiceResult<PortalSite>> {
  const access = await portal(actor, "canBook");
  if (!access.ok) return access;

  const name = cleanText(input.name, { maxLength: SITE_NAME_MAX });
  if (!name) return fail("missing_fields");
  const address = cleanText(input.address, { maxLength: SITE_LINE_MAX }) || null;
  const postalCode =
    cleanText(input.postalCode, { maxLength: LIMITS.short }) || null;
  const city = cleanText(input.city, { maxLength: LIMITS.short }) || null;

  try {
    const existingCount = await prisma.customerSite.count({
      where: { customerId: access.data.customerId },
    });
    const site = await prisma.customerSite.create({
      data: {
        customerId: access.data.customerId,
        name,
        address,
        postalCode,
        city,
        isPrimary: existingCount === 0,
      },
      select: {
        id: true,
        name: true,
        address: true,
        postalCode: true,
        city: true,
        isPrimary: true,
      },
    });
    return ok(site);
  } catch {
    return fail("conflict");
  }
}
