// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning i audit-actions.ts.
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit, type AuditActor } from "@/lib/audit";
import {
  allApiKeyScopes,
  normalizeApiKeyScopes,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";
import { cleanText, LIMITS } from "@/lib/sanitize";
import { isAdminActor, toAuditActor, type ServiceActor } from "./actor";

/**
 * API-nøkler for integrasjoner.
 *
 * Klarteksttokenet finnes bare i returverdien fra opprettelsen. Databasen
 * lagrer en SHA-256-hash og et kort prefix til visning, slik at en lekkasje av
 * databasen ikke gir tilgang til API-et. Tjenesten er administratorstyrt fordi
 * en nøkkel gir samme tilgang som brukeren den er utstedt til.
 *
 * En nøkkel har i tillegg scopes og kan være skrivebeskyttet. Det begrenser
 * hva en integrasjon kan gjøre selv om eieren har vide rettigheter.
 */

export const API_KEY_TOKEN_PREFIX = "fsm_";
/** 32 tilfeldige bytes gir 43 base64url-tegn etter prefikset. */
const API_KEY_TOKEN_BYTES = 32;
/** Antall tegn fra tokenet som lagres for gjenkjenning i grensesnittet. */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 12;
export const API_KEY_NAME_MAX_LENGTH = 80;
export const API_KEY_TOKEN_PATTERN = /^fsm_[A-Za-z0-9_-]{43}$/;

const DEFAULT_LIFETIME_DAYS = 90;
const MAX_LIFETIME_DAYS = 365;

function positiveIntFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Standard levetid når brukeren ikke oppgir en utløpsdato. */
export function apiKeyDefaultLifetimeDays(): number {
  return positiveIntFromEnv("API_KEY_DEFAULT_LIFETIME_DAYS", DEFAULT_LIFETIME_DAYS);
}

/** Maksimal levetid en nøkkel kan få. */
export function apiKeyMaxLifetimeDays(): number {
  return positiveIntFromEnv("API_KEY_MAX_LIFETIME_DAYS", MAX_LIFETIME_DAYS);
}

export type ApiKeyError =
  | "forbidden"
  | "validation_error"
  | "not_found"
  | "server_error";

export type ApiKeyOwner = {
  id: string;
  name: string | null;
  email: string | null;
};

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  user: ApiKeyOwner | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  scopes: string[];
  readOnly: boolean;
};

export type CreateApiKeyResult =
  | { ok: true; token: string; key: ApiKeySummary }
  | { ok: false; error: ApiKeyError };

export type ListApiKeysResult =
  | { ok: true; keys: ApiKeySummary[] }
  | { ok: false; error: ApiKeyError };

export type RevokeApiKeyResult =
  | { ok: true }
  | { ok: false; error: ApiKeyError };

export type RotateApiKeyResult =
  | { ok: true; token: string; key: ApiKeySummary }
  | { ok: false; error: ApiKeyError };

export type CreateApiKeyInput = {
  name?: unknown;
  expiresAt?: unknown;
  scopes?: unknown;
  readOnly?: unknown;
  /** Valgfri mottaker. Utelatt betyr aktøren selv. */
  userId?: unknown;
};

type ParsedApiKeyInput = {
  name: string;
  expiresAt: Date;
  scopes: ApiKeyScope[];
  readOnly: boolean;
};

/** Kastes av den direkte hjelpefunksjonen når input er ugyldig. */
export class ApiKeyValidationError extends Error {
  constructor() {
    super("Invalid API key input");
    this.name = "ApiKeyValidationError";
  }
}

/** SHA-256 som hex. Samme funksjon brukes ved opprettelse og autentisering. */
export function hashApiKeyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Genererer et nytt token på formen `fsm_` + 32 tilfeldige bytes. */
export function generateApiKeyToken(): string {
  return `${API_KEY_TOKEN_PREFIX}${randomBytes(API_KEY_TOKEN_BYTES).toString("base64url")}`;
}

/** Er strengen formet som et API-token? Hashen slås opp først etter denne sjekken. */
export function isApiKeyToken(value: string): boolean {
  return API_KEY_TOKEN_PATTERN.test(value);
}

/**
 * Utløpsdatoen er alltid satt. Tom verdi gir standard levetid, og en dato
 * utover maksimal levetid avvises. Da kan ikke en glemt nøkkel leve evig.
 */
function parseExpiresAt(value: unknown): Date {
  const now = Date.now();
  const maxDate = now + apiKeyMaxLifetimeDays() * 24 * 60 * 60 * 1000;
  if (value === undefined || value === null || value === "") {
    return new Date(now + apiKeyDefaultLifetimeDays() * 24 * 60 * 60 * 1000);
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiKeyValidationError();
  if (date.getTime() <= now) throw new ApiKeyValidationError();
  if (date.getTime() > maxDate) throw new ApiKeyValidationError();
  return date;
}

function parseReadOnly(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === "on";
}

/**
 * Validerer og normaliserer navn, utløpsdato, scopes og skrivebeskyttelse.
 * Navnet må være 1–80 tegn. Utelatte scopes betyr alle scopes (bakover-
 * kompatibelt for skript); en eksplisitt tom liste avvises.
 */
export function parseApiKeyInput(input: {
  name?: unknown;
  expiresAt?: unknown;
  scopes?: unknown;
  readOnly?: unknown;
}): ParsedApiKeyInput {
  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  const name = cleanText(rawName, { maxLength: LIMITS.short });
  if (
    !rawName ||
    rawName.length > API_KEY_NAME_MAX_LENGTH ||
    !name ||
    name.length > API_KEY_NAME_MAX_LENGTH
  ) {
    throw new ApiKeyValidationError();
  }

  let scopes: ApiKeyScope[];
  if (input.scopes === undefined || input.scopes === null) {
    scopes = allApiKeyScopes();
  } else {
    try {
      scopes = normalizeApiKeyScopes(input.scopes);
    } catch {
      throw new ApiKeyValidationError();
    }
    if (scopes.length === 0) throw new ApiKeyValidationError();
  }

  return {
    name,
    expiresAt: parseExpiresAt(input.expiresAt),
    scopes,
    readOnly: parseReadOnly(input.readOnly),
  };
}

const API_KEY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  userId: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  scopes: true,
  readOnly: true,
  user: {
    select: { id: true, name: true, email: true },
  },
} satisfies Prisma.ApiKeySelect;

type ApiKeyRow = Prisma.ApiKeyGetPayload<{ select: typeof API_KEY_SELECT }>;

function toSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    userId: row.userId,
    user: row.user ?? null,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    scopes: row.scopes,
    readOnly: row.readOnly,
  };
}

function createAuditAction(parsed: { name: string }, prefix: string): string {
  return `Opprettet API-nøkkel: ${parsed.name} (${prefix}…)`;
}

function revokeAuditAction(name: string, prefix: string): string {
  return `Tilbakekalte API-nøkkel: ${name} (${prefix}…)`;
}

function rotateAuditAction(name: string, oldPrefix: string, newPrefix: string): string {
  return `Rotert API-nøkkel: ${name} (${oldPrefix}… → ${newPrefix}…)`;
}

/**
 * Oppretter en nøkkel for en bestemt bruker og returnerer klarteksttokenet.
 * Brukes av tjenestelaget og av skriptet som oppretter den første nøkkelen.
 * Kallet må selv ha autorisert brukeren. Når `auditActor` er satt, skrives
 * revisjonsraden i samme transaksjon som nøkkelen.
 */
export async function createApiKeyForUser(
  userId: string,
  input: {
    name?: unknown;
    expiresAt?: unknown;
    scopes?: unknown;
    readOnly?: unknown;
  },
  auditActor?: AuditActor,
): Promise<{ token: string; apiKey: ApiKeySummary }> {
  const parsed = parseApiKeyInput(input);
  const token = generateApiKeyToken();
  const prefix = token.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.apiKey.create({
      data: {
        name: parsed.name,
        keyHash: hashApiKeyToken(token),
        prefix,
        userId,
        expiresAt: parsed.expiresAt,
        scopes: parsed.scopes,
        readOnly: parsed.readOnly,
      },
      select: API_KEY_SELECT,
    });

    if (auditActor) {
      await audit(tx, {
        entityType: "ApiKey",
        entityId: row.id,
        action: createAuditAction(parsed, prefix),
        actor: auditActor,
        metadata: {
          ownerId: userId,
          scopes: parsed.scopes,
          readOnly: parsed.readOnly,
          expiresAt: parsed.expiresAt.toISOString(),
        },
      });
    }

    return row;
  });

  return { token, apiKey: toSummary(created) };
}

/**
 * Administrator oppretter en nøkkel for seg selv eller en annen aktiv bruker.
 * Tokenet returneres bare her – det kan ikke hentes tilbake senere.
 */
export async function createApiKey(
  actor: ServiceActor,
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }

  let parsed: ParsedApiKeyInput;
  try {
    parsed = parseApiKeyInput(input);
  } catch {
    return { ok: false, error: "validation_error" };
  }

  const requestedUserId =
    typeof input.userId === "string" ? input.userId.trim() : "";
  const userId = requestedUserId || actor.id;

  // En eksplisitt mottaker må finnes og være aktiv. For egen konto er aktøren
  // allerede hentet fra en gyldig økt, så vi slipper et ekstra oppslag.
  if (userId !== actor.id) {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });
    if (!target?.isActive) return { ok: false, error: "not_found" };
  }

  try {
    const { token, apiKey } = await createApiKeyForUser(
      userId,
      parsed,
      toAuditActor(actor),
    );
    return { ok: true, token, key: apiKey };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

/** Lister alle nøkler med eier. Hash og klarteksttoken er aldri med. */
export async function listApiKeys(
  actor: ServiceActor,
): Promise<ListApiKeysResult> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }

  try {
    const rows = await prisma.apiKey.findMany({
      select: API_KEY_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return { ok: true, keys: rows.map(toSummary) };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

/** Trekker tilbake en nøkkel. Selve raden beholdes for sporbarhet. */
export async function revokeApiKey(
  actor: ServiceActor,
  id: string,
): Promise<RevokeApiKeyResult> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }

  const keyId = cleanText(id, { maxLength: LIMITS.short });
  if (!keyId) return { ok: false, error: "validation_error" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.apiKey.findUnique({
        where: { id: keyId },
        select: { id: true, name: true, prefix: true, revokedAt: true },
      });
      if (!existing) return "not_found" as const;
      if (existing.revokedAt) return "ok" as const;

      await tx.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
        select: { id: true },
      });
      await audit(tx, {
        entityType: "ApiKey",
        entityId: keyId,
        action: revokeAuditAction(existing.name, existing.prefix),
        actor: toAuditActor(actor),
      });
      return "ok" as const;
    });

    if (result === "not_found") return { ok: false, error: "not_found" };
    return { ok: true };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

/**
 * Rullerer en nøkkel: den gamle tilbakekalles og en ny med samme eier, navn,
 * scopes og skrivebeskyttelse opprettes i samme transaksjon. Klarteksttokenet
 * returneres bare én gang, som ved vanlig opprettelse.
 */
export async function rotateApiKey(
  actor: ServiceActor,
  id: string,
  input: { expiresAt?: unknown } = {},
): Promise<RotateApiKeyResult> {
  if (!actor.isActive || !isAdminActor(actor)) {
    return { ok: false, error: "forbidden" };
  }

  const keyId = cleanText(id, { maxLength: LIMITS.short });
  if (!keyId) return { ok: false, error: "validation_error" };

  try {
    const existing = await prisma.apiKey.findUnique({
      where: { id: keyId },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        revokedAt: true,
        scopes: true,
        readOnly: true,
      },
    });
    if (!existing || existing.revokedAt) {
      return { ok: false, error: "not_found" };
    }

    let parsed: ParsedApiKeyInput;
    try {
      parsed = parseApiKeyInput({
        name: existing.name,
        expiresAt: input.expiresAt,
        scopes: existing.scopes.length > 0 ? existing.scopes : allApiKeyScopes(),
        readOnly: existing.readOnly,
      });
    } catch {
      return { ok: false, error: "validation_error" };
    }

    const token = generateApiKeyToken();
    const prefix = token.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);
    const auditActor = toAuditActor(actor);

    const created = await prisma.$transaction(async (tx) => {
      await tx.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
        select: { id: true },
      });
      const row = await tx.apiKey.create({
        data: {
          name: parsed.name,
          keyHash: hashApiKeyToken(token),
          prefix,
          userId: existing.userId,
          expiresAt: parsed.expiresAt,
          scopes: parsed.scopes,
          readOnly: parsed.readOnly,
        },
        select: API_KEY_SELECT,
      });
      await audit(tx, {
        entityType: "ApiKey",
        entityId: existing.id,
        action: rotateAuditAction(existing.name, existing.prefix, prefix),
        actor: auditActor,
        metadata: { newKeyId: row.id },
      });
      await audit(tx, {
        entityType: "ApiKey",
        entityId: row.id,
        action: createAuditAction(parsed, prefix),
        actor: auditActor,
        metadata: {
          ownerId: existing.userId,
          scopes: parsed.scopes,
          readOnly: parsed.readOnly,
          expiresAt: parsed.expiresAt.toISOString(),
          rotatedFrom: existing.id,
        },
      });
      return row;
    });

    return { ok: true, token, key: toSummary(created) };
  } catch {
    return { ok: false, error: "server_error" };
  }
}
