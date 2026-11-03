// i18n-ignore-file: revisjonsloggen lagrer faste norske handlingsstrenger på
// samme måte som de øvrige tjenestene; de oversettes ved visning.
import crypto from "node:crypto";
import type { Prisma, VisitStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { estimateEta, isValidCoordinates, type Coordinates } from "@/lib/geo";
import { getRoutingProvider } from "@/lib/routing";
import type { RoutingProvider } from "@/lib/routing/types";
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

/**
 * Grensen for å regne en posisjon som «live». Et ping eldre enn dette vises
 * som sist kjente posisjon, ikke som en levende ETA. Ti minutter er nok til å
 * dekke en normal mobilforsinkelse uten å love for mye.
 */
export const LOCATION_PING_FRESH_MS = 10 * 60 * 1000;

/** Hvor ofte den offentlige ETA-ruten kan polles per gyldig token. */
export const TRACKING_ETA_RATE_LIMIT = {
  limit: 60,
  windowMs: 60_000,
} as const;

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

export type TrackingEtaSource = "live" | "planned" | "stale" | "on_site";

export type PublicTrackingView = {
  technicianFirstName: string | null;
  status: VisitStatus;
  etaMinutes: number | null;
  estimatedArrivalAt: Date | null;
  /** Planlagt starttid fra kalenderen. Vises når vi ikke har en live ETA. */
  plannedStartsAt: Date;
  /** `live` bare når posisjonen er fersk og reisen er beregnet. */
  etaSource: TrackingEtaSource;
  /** Sann når siste ping er innenfor ferskhetsgrensen. */
  hasLivePosition: boolean;
  /** Sann når et ping finnes, men er for gammelt til å være live. */
  stale: boolean;
  /** Alder på siste ping i hele minutter. */
  pingAgeMinutes: number | null;
  lastUpdatedAt: Date | null;
  travelProvider: "osrm" | "haversine" | null;
};

/** ETA-ruten returnerer aldri montørens navn eller andre personopplysninger. */
export type PublicTrackingEtaView = Omit<
  PublicTrackingView,
  "technicianFirstName"
>;

export type PublicTrackingResult =
  | { ok: true; data: PublicTrackingView }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

export type PublicTrackingEtaResult =
  | { ok: true; data: PublicTrackingEtaView }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

const publicTrackingLinkSelect = {
  id: true,
  expiresAt: true,
  revokedAt: true,
  visitId: true,
  visit: {
    select: {
      status: true,
      startsAt: true,
      technicians: {
        orderBy: { userId: "asc" },
        take: 1,
        select: { user: { select: { name: true } } },
      },
      workOrder: {
        select: {
          latitude: true,
          longitude: true,
          site: { select: { latitude: true, longitude: true } },
          customer: {
            select: {
              sites: {
                where: { isPrimary: true },
                take: 1,
                select: { latitude: true, longitude: true },
              },
            },
          },
          department: { select: { trackingEnabled: true } },
        },
      },
    },
  },
} satisfies Prisma.TrackingLinkSelect;

type PublicTrackingLink = Prisma.TrackingLinkGetPayload<{
  select: typeof publicTrackingLinkSelect;
}>;

function publicDestination(link: PublicTrackingLink): Coordinates | null {
  const workOrder = link.visit.workOrder;
  if (
    workOrder.latitude !== null &&
    workOrder.longitude !== null &&
    isValidCoordinates(workOrder.latitude, workOrder.longitude)
  ) {
    return { latitude: workOrder.latitude, longitude: workOrder.longitude };
  }
  const site = workOrder.site;
  if (
    site &&
    site.latitude !== null &&
    site.longitude !== null &&
    isValidCoordinates(site.latitude, site.longitude)
  ) {
    return { latitude: site.latitude, longitude: site.longitude };
  }
  const primarySite = workOrder.customer?.sites?.[0];
  if (
    primarySite &&
    primarySite.latitude !== null &&
    primarySite.longitude !== null &&
    isValidCoordinates(primarySite.latitude, primarySite.longitude)
  ) {
    return {
      latitude: primarySite.latitude,
      longitude: primarySite.longitude,
    };
  }
  return null;
}

function validToken(token: string): boolean {
  return TRACKING_TOKEN_PATTERN.test(token);
}

async function loadPublicTrackingLink(
  token: string,
  now: Date,
): Promise<PublicTrackingLink | null> {
  if (!validToken(token)) return null;

  const link = await prisma.trackingLink.findUnique({
    where: { tokenHash: hashTrackingToken(token) },
    select: publicTrackingLinkSelect,
  });

  if (
    !link ||
    link.revokedAt ||
    link.expiresAt.getTime() <= now.getTime() ||
    !link.visit.workOrder.department.trackingEnabled ||
    !PUBLIC_TRACKING_STATUSES.includes(link.visit.status)
  ) {
    return null;
  }
  return link;
}

async function estimateLiveArrival(input: {
  from: Coordinates;
  to: Coordinates;
  now: Date;
  routing: RoutingProvider;
}): Promise<{
  minutes: number;
  arrivalAt: Date;
  provider: "osrm" | "haversine";
} | null> {
  try {
    const estimate = await input.routing.route(input.from, input.to);
    if (
      Number.isFinite(estimate.durationMinutes) &&
      estimate.durationMinutes >= 0
    ) {
      return {
        minutes: Math.max(0, Math.round(estimate.durationMinutes)),
        arrivalAt: new Date(
          input.now.getTime() + estimate.durationMinutes * 60_000,
        ),
        provider: estimate.provider,
      };
    }
  } catch {
    // En ekstern leverandør som er nede skal falle tilbake til samme
    // haversine-beregning som resten av appen – ikke gi en falsk ETA.
  }

  const fallback = estimateEta({
    from: input.from,
    to: input.to,
    now: input.now,
  });
  if (!fallback) return null;
  return {
    minutes: fallback.minutes,
    arrivalAt: fallback.estimatedArrivalAt,
    provider: "haversine",
  };
}

async function buildTrackingSnapshot(
  link: PublicTrackingLink,
  now: Date,
  routing: RoutingProvider,
): Promise<PublicTrackingEtaView> {
  const ping = await prisma.visitLocationPing.findFirst({
    where: {
      visitId: link.visitId,
      recordedAt: { gte: new Date(now.getTime() - LOCATION_PING_RETENTION_MS) },
    },
    orderBy: { recordedAt: "desc" },
    select: { latitude: true, longitude: true, recordedAt: true },
  });

  const ageMs = ping
    ? Math.max(0, now.getTime() - ping.recordedAt.getTime())
    : null;
  const stale = ageMs !== null && ageMs > LOCATION_PING_FRESH_MS;
  const hasLivePosition = Boolean(ping) && !stale;
  const destination = publicDestination(link);

  let eta:
    | { minutes: number; arrivalAt: Date; provider: "osrm" | "haversine" }
    | null = null;
  if (
    link.visit.status === "EN_ROUTE" &&
    ping &&
    !stale &&
    destination &&
    isValidCoordinates(ping.latitude, ping.longitude)
  ) {
    eta = await estimateLiveArrival({
      from: { latitude: ping.latitude, longitude: ping.longitude },
      to: destination,
      now,
      routing,
    });
  }

  const etaSource: TrackingEtaSource =
    link.visit.status === "ON_SITE"
      ? "on_site"
      : !ping
        ? "planned"
        : stale
          ? "stale"
          : eta
            ? "live"
            : "planned";

  return {
    status: link.visit.status,
    etaMinutes: eta?.minutes ?? null,
    estimatedArrivalAt: eta?.arrivalAt ?? null,
    plannedStartsAt: link.visit.startsAt,
    etaSource,
    hasLivePosition,
    stale,
    pingAgeMinutes:
      ageMs === null ? null : Math.floor(ageMs / 60_000),
    lastUpdatedAt: ping?.recordedAt ?? null,
    travelProvider: eta?.provider ?? null,
  };
}

async function allowTrackingToken(
  tokenHash: string,
  keyPrefix: string,
  limit: number,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const result = await allowRequestDb(
    `${keyPrefix}:${tokenHash}`,
    limit,
    60_000,
  );
  return result.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
}

/**
 * Leser den offentlige sporingstilstanden. Koordinater returneres aldri til
 * klienten – bare status, montørens fornavn, ETA, planlagt tid og tidspunktet
 * for siste posisjonsoppdatering.
 *
 * En lenke som er ukjent, tilbakekalt, utløpt, tilhører en avdeling med
 * sporing avslått, eller en visitt som ikke lenger er EN_ROUTE/ON_SITE, gir
 * samme `invalid`-svar. Da kan ikke lenken brukes til å gjette seg til status.
 */
export async function getPublicTracking(
  token: string,
  now = new Date(),
  options: { routing?: RoutingProvider } = {},
): Promise<PublicTrackingResult> {
  if (validToken(token) && !allowGlobalTracking(now.getTime())) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 60 };
  }
  const link = await loadPublicTrackingLink(token, now);
  if (!link) return { ok: false, reason: "invalid" };

  const tokenHash = hashTrackingToken(token);
  // Grensen ligger per gyldig token, som for iCal-feeden. Ukjente tokens
  // skriver aldri en RateLimit-rad.
  const limit = await allowTrackingToken(tokenHash, "tracking", 120);
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

  const snapshot = await buildTrackingSnapshot(
    link,
    now,
    options.routing ?? getRoutingProvider(),
  );
  const technicianName = link.visit.technicians[0]?.user.name ?? null;

  return {
    ok: true,
    data: {
      ...snapshot,
      technicianFirstName: firstName(technicianName),
    },
  };
}

/**
 * Lettvekts ETA for den offentlige siden. Tokenet gir bare tilgang til denne
 * ene visitten, og svaret inneholder verken navn, adresse eller koordinater.
 * Egen rate limit gjør at polling ikke spiser av sidevisningens budsjett.
 */
export async function getPublicTrackingEta(
  token: string,
  now = new Date(),
  options: { routing?: RoutingProvider } = {},
): Promise<PublicTrackingEtaResult> {
  if (validToken(token) && !allowGlobalTracking(now.getTime())) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 60 };
  }
  const link = await loadPublicTrackingLink(token, now);
  if (!link) return { ok: false, reason: "invalid" };

  const tokenHash = hashTrackingToken(token);
  const limit = await allowTrackingToken(
    tokenHash,
    "tracking-eta",
    TRACKING_ETA_RATE_LIMIT.limit,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  return {
    ok: true,
    data: await buildTrackingSnapshot(
      link,
      now,
      options.routing ?? getRoutingProvider(),
    ),
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
