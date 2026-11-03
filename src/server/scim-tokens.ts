// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data.
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { audit, type AuditActor } from "@/lib/audit";
import { cleanText, LIMITS } from "@/lib/sanitize";
import { allowRequestDb } from "@/lib/rate-limit-db";
import {
  SCIM_CONTENT_TYPE,
  scimErrorBody,
} from "@/lib/scim";
import { isAdminActor, toAuditActor, type ServiceActor } from "./actor";

/**
 * SCIM-tokens.
 *
 * Et token gir tilgang til hele SCIM-flaten for brukere, så det er alltid
 * administratorstyrt. Bare SHA-256-hashen og et kort visningsprefiks lagres.
 * Klarteksttokenet returneres én gang ved opprettelse eller rotasjon.
 */

export const SCIM_TOKEN_PREFIX = "scim_";
const SCIM_TOKEN_BYTES = 32;
export const SCIM_TOKEN_DISPLAY_PREFIX_LENGTH = 12;
export const SCIM_TOKEN_NAME_MAX_LENGTH = 80;
export const SCIM_TOKEN_PATTERN = /^scim_[A-Za-z0-9_-]{43}$/;

const DEFAULT_LIFETIME_DAYS = 365;
const MAX_LIFETIME_DAYS = 730;

/** Delt grense per token, som for API-nøkler. */
export const SCIM_RATE_LIMIT = 120;
export const SCIM_RATE_WINDOW_MS = 60_000;

/** Minste intervall mellom revisjonsrader for bruk av samme token. */
const USE_AUDIT_INTERVAL_MS = 60 * 60_000;

export type ScimTokenError =
  | "forbidden"
  | "validation_error"
  | "not_found"
  | "server_error";

/** Aktøren SCIM-tjenestene og revisjonsloggen handler på vegne av. */
export type ScimTokenActor = {
  tokenId: string;
  tokenName: string;
  createdById: string | null;
};

export function scimActorFromToken(token: {
  id: string;
  name: string;
  createdById: string | null;
}): ScimTokenActor {
  return {
    tokenId: token.id,
    tokenName: token.name,
    createdById: token.createdById,
  };
}

export type ScimTokenSummary = {
  id: string;
  name: string;
  prefix: string;
  createdById: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type ScimTokenServices = {
  create: (
    actor: ServiceActor,
    input: { name?: unknown; expiresAt?: unknown },
  ) => Promise<
    | { ok: true; token: string; scimToken: ScimTokenSummary }
    | { ok: false; error: ScimTokenError }
  >;
  list: (
    actor: ServiceActor,
  ) => Promise<
    { ok: true; tokens: ScimTokenSummary[] } | { ok: false; error: ScimTokenError }
  >;
  revoke: (
    actor: ServiceActor,
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: ScimTokenError }>;
  rotate: (
    actor: ServiceActor,
    id: string,
    input?: { expiresAt?: unknown },
  ) => Promise<
    | { ok: true; token: string; scimToken: ScimTokenSummary }
    | { ok: false; error: ScimTokenError }
  >;
};

export class ScimTokenValidationError extends Error {
  constructor() {
    super("Invalid SCIM token input");
    this.name = "ScimTokenValidationError";
  }
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function scimTokenDefaultLifetimeDays(): number {
  return positiveIntFromEnv(
    "SCIM_TOKEN_DEFAULT_LIFETIME_DAYS",
    DEFAULT_LIFETIME_DAYS,
  );
}

export function scimTokenMaxLifetimeDays(): number {
  return positiveIntFromEnv("SCIM_TOKEN_MAX_LIFETIME_DAYS", MAX_LIFETIME_DAYS);
}

export function hashScimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateScimToken(): string {
  return `${SCIM_TOKEN_PREFIX}${randomBytes(SCIM_TOKEN_BYTES).toString("base64url")}`;
}

export function isScimToken(value: string): boolean {
  return SCIM_TOKEN_PATTERN.test(value);
}

function parseExpiresAt(value: unknown): Date {
  const now = Date.now();
  const maxDate = now + scimTokenMaxLifetimeDays() * 24 * 60 * 60 * 1000;
  if (value === undefined || value === null || value === "") {
    return new Date(now + scimTokenDefaultLifetimeDays() * 24 * 60 * 60 * 1000);
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ScimTokenValidationError();
  if (date.getTime() <= now) throw new ScimTokenValidationError();
  if (date.getTime() > maxDate) throw new ScimTokenValidationError();
  return date;
}

function parseScimTokenInput(input: {
  name?: unknown;
  expiresAt?: unknown;
}): { name: string; expiresAt: Date } {
  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  const name = cleanText(rawName, { maxLength: LIMITS.short });
  if (
    !rawName ||
    rawName.length > SCIM_TOKEN_NAME_MAX_LENGTH ||
    !name ||
    name.length > SCIM_TOKEN_NAME_MAX_LENGTH
  ) {
    throw new ScimTokenValidationError();
  }
  return { name, expiresAt: parseExpiresAt(input.expiresAt) };
}

const SCIM_TOKEN_SELECT = {
  id: true,
  name: true,
  prefix: true,
  createdById: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} satisfies Prisma.ScimTokenSelect;

type ScimTokenRow = Prisma.ScimTokenGetPayload<{
  select: typeof SCIM_TOKEN_SELECT;
}>;

function toSummary(row: ScimTokenRow): ScimTokenSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdById: row.createdById,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

function auditActorFor(actor: ServiceActor): AuditActor {
  return toAuditActor(actor);
}

/**
 * Oppretter et token for en administrator og returnerer klarteksttokenet.
 * Funksjonen gjør autorisasjonen selv, slik at skript og UI deler samme regel.
 */
export async function createScimToken(
  actor: ServiceActor,
  input: { name?: unknown; expiresAt?: unknown },
): Promise<
  | { ok: true; token: string; scimToken: ScimTokenSummary }
  | { ok: false; error: ScimTokenError }
> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }

  let parsed: { name: string; expiresAt: Date };
  try {
    parsed = parseScimTokenInput(input);
  } catch {
    return { ok: false, error: "validation_error" };
  }

  const token = generateScimToken();
  const prefix = token.slice(0, SCIM_TOKEN_DISPLAY_PREFIX_LENGTH);

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.scimToken.create({
        data: {
          name: parsed.name,
          tokenHash: hashScimToken(token),
          prefix,
          createdById: actor.id,
          expiresAt: parsed.expiresAt,
        },
        select: SCIM_TOKEN_SELECT,
      });
      await audit(tx, {
        entityType: "ScimToken",
        entityId: created.id,
        action: `Opprettet SCIM-token: ${parsed.name} (${prefix}…)`,
        actor: auditActorFor(actor),
        metadata: {
          expiresAt: parsed.expiresAt.toISOString(),
          prefix,
        },
      });
      return created;
    });
    return { ok: true, token, scimToken: toSummary(row) };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

export async function listScimTokens(
  actor: ServiceActor,
): Promise<
  { ok: true; tokens: ScimTokenSummary[] } | { ok: false; error: ScimTokenError }
> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }
  try {
    const rows = await prisma.scimToken.findMany({
      select: SCIM_TOKEN_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return { ok: true, tokens: rows.map(toSummary) };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

/** Tilbakekaller et token. Raden beholdes for sporbarhet. */
export async function revokeScimToken(
  actor: ServiceActor,
  id: string,
): Promise<{ ok: true } | { ok: false; error: ScimTokenError }> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }
  const tokenId = cleanText(id, { maxLength: LIMITS.short });
  if (!tokenId) return { ok: false, error: "validation_error" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.scimToken.findUnique({
        where: { id: tokenId },
        select: { id: true, name: true, prefix: true, revokedAt: true },
      });
      if (!existing) return "not_found" as const;
      if (existing.revokedAt) return "ok" as const;

      await tx.scimToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
        select: { id: true },
      });
      await audit(tx, {
        entityType: "ScimToken",
        entityId: tokenId,
        action: `Tilbakekalte SCIM-token: ${existing.name} (${existing.prefix}…)`,
        actor: auditActorFor(actor),
      });
      return "ok" as const;
    });
    return result === "not_found"
      ? { ok: false, error: "not_found" }
      : { ok: true };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

/**
 * Roterer et token: den gamle tilbakekalles og en ny med samme navn opprettes
 * i samme transaksjon. Klarteksttokenet vises bare i returverdien.
 */
export async function rotateScimToken(
  actor: ServiceActor,
  id: string,
  input: { expiresAt?: unknown } = {},
): Promise<
  | { ok: true; token: string; scimToken: ScimTokenSummary }
  | { ok: false; error: ScimTokenError }
> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }
  const tokenId = cleanText(id, { maxLength: LIMITS.short });
  if (!tokenId) return { ok: false, error: "validation_error" };

  try {
    const existing = await prisma.scimToken.findUnique({
      where: { id: tokenId },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdById: true,
        revokedAt: true,
      },
    });
    if (!existing || existing.revokedAt) {
      return { ok: false, error: "not_found" };
    }

    const parsed = parseScimTokenInput({
      name: existing.name,
      expiresAt: input.expiresAt,
    });
    const token = generateScimToken();
    const prefix = token.slice(0, SCIM_TOKEN_DISPLAY_PREFIX_LENGTH);
    const auditActor = auditActorFor(actor);

    const created = await prisma.$transaction(async (tx) => {
      await tx.scimToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
        select: { id: true },
      });
      const row = await tx.scimToken.create({
        data: {
          name: parsed.name,
          tokenHash: hashScimToken(token),
          prefix,
          createdById: existing.createdById,
          expiresAt: parsed.expiresAt,
        },
        select: SCIM_TOKEN_SELECT,
      });
      await audit(tx, {
        entityType: "ScimToken",
        entityId: existing.id,
        action: `Rotert SCIM-token: ${existing.name} (${existing.prefix}… → ${prefix}…)`,
        actor: auditActor,
        metadata: { newTokenId: row.id },
      });
      await audit(tx, {
        entityType: "ScimToken",
        entityId: row.id,
        action: `Opprettet SCIM-token: ${parsed.name} (${prefix}…)`,
        actor: auditActor,
        metadata: {
          expiresAt: parsed.expiresAt.toISOString(),
          rotatedFrom: existing.id,
          prefix,
        },
      });
      return row;
    });

    return { ok: true, token, scimToken: toSummary(created) };
  } catch (error) {
    if (error instanceof ScimTokenValidationError) {
      return { ok: false, error: "validation_error" };
    }
    return { ok: false, error: "server_error" };
  }
}

function scimResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

/** Bearer-token fra `Authorization`, uten å godta andre kilder. */
export function scimBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export type ScimAuthResult =
  | {
      ok: true;
      token: {
        id: string;
        name: string;
        prefix: string;
        createdById: string | null;
      };
    }
  | { ok: false; response: NextResponse };

function unauthorized(detail = "Ugyldig eller manglende SCIM-token."): ScimAuthResult {
  const response = scimResponse(scimErrorBody(401, detail), 401, {
    "WWW-Authenticate": 'Bearer realm="fsm-scim", error="invalid_token"',
  });
  return { ok: false, response };
}

/** 403 når tokenets oppretter er deaktivert. Selve tokenet er ellers gyldig. */
function forbidden(detail: string): ScimAuthResult {
  return { ok: false, response: scimResponse(scimErrorBody(403, detail), 403) };
}

/**
 * Autentiserer en SCIM-forespørsel. Sesjonscookies godtas aldri. Tokenet må
 * være aktivt og ikke utløpt, og administratoren som opprettet det må fortsatt
 * være aktiv. Bruk oppdateres, og revisjonsloggen skrives maks én gang i timen
 * per token for å unngå støy.
 */
export async function authenticateScimRequest(
  request: Request,
): Promise<ScimAuthResult> {
  const token = scimBearerToken(request);
  if (!token) return unauthorized();
  if (!isScimToken(token)) return unauthorized();

  try {
    const row = await prisma.scimToken.findUnique({
      where: { tokenHash: hashScimToken(token) },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdById: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    });

    const now = new Date();
    if (!row || row.revokedAt) return unauthorized();
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) {
      return unauthorized("SCIM-tokenet er utløpt.");
    }

    if (row.createdById) {
      const creator = await prisma.user.findUnique({
        where: { id: row.createdById },
        select: { isActive: true },
      });
      if (!creator?.isActive) {
        return forbidden("Administratoren som opprettet SCIM-tokenet er inaktiv.");
      }
    }

    const limit = await allowRequestDb(
      `scim-token:${row.id}`,
      SCIM_RATE_LIMIT,
      SCIM_RATE_WINDOW_MS,
    );
    if (!limit.allowed) {
      const retryAfter = Number.isFinite(limit.retryAfterSeconds)
        ? Math.max(0, Math.ceil(limit.retryAfterSeconds))
        : 60;
      return {
        ok: false,
        response: scimResponse(
          scimErrorBody(429, "For mange SCIM-kall. Prøv igjen senere."),
          429,
          { "Retry-After": String(retryAfter) },
        ),
      };
    }

    const shouldAuditUse =
      !row.lastUsedAt ||
      now.getTime() - new Date(row.lastUsedAt).getTime() >= USE_AUDIT_INTERVAL_MS;

    await prisma.scimToken.update({
      where: { id: row.id },
      data: { lastUsedAt: now },
      select: { id: true },
    });

    if (shouldAuditUse) {
      try {
        await prisma.auditLog.create({
          data: {
            entityType: "ScimToken",
            entityId: row.id,
            action: `SCIM-token brukt: ${row.name} (${row.prefix}…)`,
            userName: "SCIM",
            actorId: row.createdById,
            metadata: { prefix: row.prefix },
          },
        });
      } catch {
        // Bruk skal ikke feile fordi revisjonsloggen ikke kan skrives.
      }
    }

    return {
      ok: true,
      token: {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        createdById: row.createdById,
      },
    };
  } catch {
    return {
      ok: false,
      response: scimResponse(
        scimErrorBody(500, "Kunne ikke autentisere SCIM-forespørselen."),
        500,
      ),
    };
  }
}
