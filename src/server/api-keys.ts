import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { cleanText, LIMITS } from "@/lib/sanitize";
import { isAdminActor, type ServiceActor } from "./actor";

/**
 * API-nøkler for integrasjoner.
 *
 * Klarteksttokenet finnes bare i returverdien fra opprettelsen. Databasen
 * lagrer en SHA-256-hash og et kort prefix til visning, slik at en lekkasje av
 * databasen ikke gir tilgang til API-et. Tjenesten er administratorstyrt fordi
 * en nøkkel gir samme tilgang som brukeren den er utstedt til.
 */

export const API_KEY_TOKEN_PREFIX = "fsm_";
/** 32 tilfeldige bytes gir 43 base64url-tegn etter prefikset. */
const API_KEY_TOKEN_BYTES = 32;
/** Antall tegn fra tokenet som lagres for gjenkjenning i grensesnittet. */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 12;
export const API_KEY_NAME_MAX_LENGTH = 80;
export const API_KEY_TOKEN_PATTERN = /^fsm_[A-Za-z0-9_-]{43}$/;

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

export type CreateApiKeyInput = {
  name?: unknown;
  expiresAt?: unknown;
  /** Valgfri mottaker. Utelatt betyr aktøren selv. */
  userId?: unknown;
};

type ParsedApiKeyInput = {
  name: string;
  expiresAt: Date | null;
};

/** Kastes av den direkte hjelpefunksjonen når input er ugyldig. */
export class ApiKeyValidationError extends Error {
  constructor() {
    super("Ugyldig API-nøkkelinput");
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

function parseExpiresAt(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiKeyValidationError();
  if (date.getTime() <= Date.now()) throw new ApiKeyValidationError();
  return date;
}

/**
 * Validerer og normaliserer navn og utløpsdato. Navnet må være 1–80 tegn, og
 * en eventuell utløpsdato må ligge i fremtiden.
 */
export function parseApiKeyInput(input: {
  name?: unknown;
  expiresAt?: unknown;
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

  return { name, expiresAt: parseExpiresAt(input.expiresAt) };
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
  };
}

/**
 * Oppretter en nøkkel for en bestemt bruker og returnerer klarteksttokenet.
 * Brukes av tjenestelaget og av skriptet som oppretter den første nøkkelen.
 * Kallet må selv ha autorisert brukeren.
 */
export async function createApiKeyForUser(
  userId: string,
  input: { name?: unknown; expiresAt?: unknown },
): Promise<{ token: string; apiKey: ApiKeySummary }> {
  const parsed = parseApiKeyInput(input);
  const token = generateApiKeyToken();

  const created = await prisma.apiKey.create({
    data: {
      name: parsed.name,
      keyHash: hashApiKeyToken(token),
      prefix: token.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
      userId,
      expiresAt: parsed.expiresAt,
    },
    select: API_KEY_SELECT,
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
    const { token, apiKey } = await createApiKeyForUser(userId, parsed);
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

  const existing = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.revokedAt) return { ok: true };

  try {
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
      select: { id: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "server_error" };
  }
}
