// i18n-ignore-file: revisjonsloggen lagrer faste norske handlingsstrenger på
// samme måte som de øvrige tjenestene; de oversettes ved visning.
import crypto from "node:crypto";
import type { Prisma, VisitStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { estimateEta } from "@/lib/geo";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  can,
  fail,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** SporingsTokens er 32 tilfeldige byte, hex-kodet (64 tegn). */
export const TRACKING_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Lenken lever i to timer etter at visitten er planlagt ferdig. */
export const TRACKING_LINK_TTL_AFTER_VISIT_MS = 2 * 60 * 60 * 1000;

/** Posisjonsping slettes etter 24 timer. Ingen historikk eksponeres. */
export const LOCATION_PING_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Statusene der en offentlig sporingslenke kan vise noe. */
const PUBLIC_TRACKING_STATUSES: readonly VisitStatus[] = ["EN_ROUTE", "ON_SITE"];

/** Global, prosesslokal sikring mot flom av tilfeldige velformede tokens. */
const globalTrackingWindow = { startedAt: 0, count: 0 };
function allowGlobalTracking(now = Date.now()): boolean {
  if (now - globalTrackingWindow.startedAt >= 60_000) {
    globalTrackingWindow.startedAt = now;
    globalTrackingWindow.count = 0;
  }
  globalTrackingWindow.count += 1;
  return globalTrackingWindow.count <= 1200;
}

export function hashTrackingToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newTrackingToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Utløpstidspunktet for en ny lenke: visittens slutt + to timer. */
export function trackingLinkExpiresAt(visitEndsAt: Date): Date {
  return new Date(visitEndsAt.getTime() + TRACKING_LINK_TTL_AFTER_VISIT_MS);
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function firstName(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value) return null;
  return value.split(/\s+/)[0] ?? null;
}

export type CreateTrackingLinkResult = {
  id: string;
  token: string;
  expiresAt: Date;
};

/**
 * Oppretter en ny offentlig sporingslenke for én visitt.
 *
 * Krever `workorders.edit`, avdelingsscope og at avdelingen har slått på
 * sporing. Alle tidligere aktive lenker for samme visitt tilbakekalles i samme
 * transaksjon, slik at det bare finnes én gyldig lenke om gangen. Tokenet
 * returneres bare her; databasen lagrer utelukkende SHA-256-hashen.
 */
export async function createTrackingLink(
  actor: ServiceActor,
  visitId: string,
): Promise<ServiceResult<CreateTrackingLinkResult>> {
  if (!actor?.isActive || !can(actor, "workorders.edit")) {
    return fail("forbidden");
  }

  const id = cleanId(visitId);
  if (!id) return fail("invalid", { code: "tracking.errors.invalidInput" });

  return prisma.$transaction(async (tx) => {
    const visit = await tx.visit.findFirst({
      where: {
        id,
        workOrder: { AND: [workOrderScopeFor(actor)] },
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

    if (!visit.workOrder.department.trackingEnabled) {
      return fail("forbidden", { code: "tracking.errors.disabled" });
    }
    if (visit.status === "DONE" || visit.status === "CANCELLED") {
      return fail("conflict", { code: "tracking.errors.visitLocked" });
    }

    const expiresAt = trackingLinkExpiresAt(visit.endsAt);
    if (expiresAt.getTime() <= Date.now()) {
      return fail("invalid", { code: "tracking.errors.expired" });
    }

    await tx.trackingLink.updateMany({
      where: { visitId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = newTrackingToken();
    const link = await tx.trackingLink.create({
      data: {
        tokenHash: hashTrackingToken(token),
        workOrderId: visit.workOrderId,
        visitId: id,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    await audit(tx, {
      entityType: "TrackingLink",
      entityId: link.id,
      action: `Opprettet sporingslenke for ${visit.workOrder.title}`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: visit.workOrderId,
        visitId: id,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return ok({ id: link.id, token, expiresAt: link.expiresAt });
  });
}

/**
 * Tilbakekaller en lenke umiddelbart. Idempotent: en allerede tilbakekalt
 * lenke gir fortsatt `ok`, uten å overskrive det opprinnelige tidspunktet.
 */
export async function revokeTrackingLink(
  actor: ServiceActor,
  trackingLinkId: string,
): Promise<ServiceResult<{ revokedAt: Date }>> {
  if (!actor?.isActive || !can(actor, "workorders.edit")) {
    return fail("forbidden");
  }

  const id = cleanId(trackingLinkId);
  if (!id) return fail("invalid", { code: "tracking.errors.invalidInput" });

  return prisma.$transaction(async (tx) => {
    const link = await tx.trackingLink.findFirst({
      where: {
        id,
        workOrder: { AND: [workOrderScopeFor(actor)] },
      },
      select: {
        id: true,
        workOrderId: true,
        visitId: true,
        revokedAt: true,
        workOrder: { select: { title: true } },
      },
    });
    if (!link) return fail("not_found");

    if (link.revokedAt) return ok({ revokedAt: link.revokedAt });

    const revokedAt = new Date();
    await tx.trackingLink.update({
      where: { id },
      data: { revokedAt },
    });

    await audit(tx, {
      entityType: "TrackingLink",
      entityId: id,
      action: `Tilbakekalte sporingslenke for ${link.workOrder.title}`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: link.workOrderId,
        visitId: link.visitId,
      },
    });

    return ok({ revokedAt });
  });
}

/**
 * Tilbakekaller alle aktive lenker for en visitt. Kalles når visitten blir
 * DONE eller CANCELLED, slik at en glemt lenke ikke fortsetter å svare.
 */
export async function revokeTrackingLinksForVisit(
  tx: Prisma.TransactionClient,
  visitId: string,
  revokedAt = new Date(),
): Promise<number> {
  const result = await tx.trackingLink.updateMany({
    where: { visitId, revokedAt: null },
    data: { revokedAt },
  });
  return result.count;
}

export type PublicTrackingView = {
  technicianFirstName: string | null;
  status: VisitStatus;
  etaMinutes: number | null;
  estimatedArrivalAt: Date | null;
  lastUpdatedAt: Date | null;
};

export type PublicTrackingResult =
  | { ok: true; data: PublicTrackingView }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Leser den offentlige sporingstilstanden. Koordinater returneres aldri til
 * klienten – bare status, montørens fornavn, ETA og tidspunktet for siste
 * posisjonsoppdatering.
 *
 * En lenke som er ukjent, tilbakekalt, utløpt, tilhører en avdeling med
 * sporing avslått, eller en visitt som ikke lenger er EN_ROUTE/ON_SITE, gir
 * samme `invalid`-svar. Da kan ikke lenken brukes til å gjette seg til status.
 */
export async function getPublicTracking(
  token: string,
  now = new Date(),
): Promise<PublicTrackingResult> {
  if (!TRACKING_TOKEN_PATTERN.test(token)) return { ok: false, reason: "invalid" };
  if (!allowGlobalTracking(now.getTime())) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 60 };
  }

  const tokenHash = hashTrackingToken(token);
  const link = await prisma.trackingLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      visitId: true,
      visit: {
        select: {
          status: true,
          technicians: {
            orderBy: { userId: "asc" },
            take: 1,
            select: { user: { select: { name: true } } },
          },
          workOrder: {
            select: {
              latitude: true,
              longitude: true,
              department: { select: { trackingEnabled: true } },
            },
          },
        },
      },
    },
  });

  if (
    !link ||
    link.revokedAt ||
    link.expiresAt.getTime() <= now.getTime() ||
    !link.visit.workOrder.department.trackingEnabled ||
    !PUBLIC_TRACKING_STATUSES.includes(link.visit.status)
  ) {
    return { ok: false, reason: "invalid" };
  }

  // Grensen ligger per gyldig token, som for iCal-feeden. Ukjente tokens
  // skriver aldri en RateLimit-rad.
  const limit = await allowRequestDb(`tracking:${tokenHash}`, 120, 60_000);
  if (!limit.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  await prisma.trackingLink.update({
    where: { id: link.id },
    data: { lastUsedAt: new Date() },
  });

  const ping = await prisma.visitLocationPing.findFirst({
    where: {
      visitId: link.visitId,
      recordedAt: { gte: new Date(now.getTime() - LOCATION_PING_RETENTION_MS) },
    },
    orderBy: { recordedAt: "desc" },
    select: { latitude: true, longitude: true, recordedAt: true },
  });

  const technicianName =
    link.visit.technicians[0]?.user.name ?? null;
  const eta =
    link.visit.status === "EN_ROUTE" && ping
      ? estimateEta({
          from: { lat: ping.latitude, lng: ping.longitude },
          to:
            link.visit.workOrder.latitude !== null &&
            link.visit.workOrder.longitude !== null
              ? {
                  lat: link.visit.workOrder.latitude,
                  lng: link.visit.workOrder.longitude,
                }
              : null,
          now,
        })
      : null;

  return {
    ok: true,
    data: {
      technicianFirstName: firstName(technicianName),
      status: link.visit.status,
      etaMinutes: eta?.minutes ?? null,
      estimatedArrivalAt: eta?.estimatedArrivalAt ?? null,
      lastUpdatedAt: ping?.recordedAt ?? null,
    },
  };
}

export type RecordLocationPingInput = {
  visitId: string;
  latitude: number;
  longitude: number;
};

export type RecordLocationPingResult = {
  id: string;
  recordedAt: Date;
};

/**
 * Registrerer ett posisjonsping fra den innloggede montøren.
 *
 * Vilkårene er strenge og kontrolleres på nytt i databasen:
 * - brukeren må være tildelt akkurat denne visitten,
 * - visitten må være EN_ROUTE,
 * - avdelingen må ha sporing på,
 * - koordinatene må være gyldige.
 *
 * Tjenesten lagrer aldri mer enn punktet og tidspunktet. Klienten skal ikke
 * køe ping offline eller spille dem av senere; hvert kall er fersk posisjon.
 */
export async function recordLocationPing(
  actor: ServiceActor,
  input: RecordLocationPingInput,
): Promise<ServiceResult<RecordLocationPingResult>> {
  if (!actor?.isActive) return fail("forbidden");

  const visitId = cleanId(input?.visitId);
  if (
    !visitId ||
    typeof input.latitude !== "number" ||
    typeof input.longitude !== "number" ||
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    return fail("invalid", { code: "tracking.errors.invalidCoordinates" });
  }

  const visit = await prisma.visit.findFirst({
    where: {
      id: visitId,
      status: "EN_ROUTE",
      technicians: { some: { userId: actor.id } },
      workOrder: {
        deletedAt: null,
        department: { isActive: true, trackingEnabled: true },
      },
    },
    select: { id: true },
  });
  if (!visit) return fail("not_found");

  const recordedAt = new Date();
  const ping = await prisma.visitLocationPing.create({
    data: {
      visitId,
      userId: actor.id,
      latitude: input.latitude,
      longitude: input.longitude,
      recordedAt,
    },
    select: { id: true, recordedAt: true },
  });

  return ok({ id: ping.id, recordedAt: ping.recordedAt });
}

/**
 * Sletter posisjonsping eldre enn 24 timer. Kalles av den vedvarende
 * jobbworkeren og kan også kjøres manuelt fra cron.
 */
export async function cleanupVisitLocationPings(
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - LOCATION_PING_RETENTION_MS);
  const result = await prisma.visitLocationPing.deleteMany({
    where: { recordedAt: { lt: cutoff } },
  });
  return result.count;
}
