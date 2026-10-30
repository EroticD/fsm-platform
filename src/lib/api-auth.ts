import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { apiError } from "@/lib/api-response";
import type { ServiceActor } from "@/server/actor";
import { hashApiKeyToken, isApiKeyToken } from "@/server/api-keys";

/** Grensen gjelder per nøkkel og deles av alle app-instanser via databasen. */
export const API_KEY_RATE_LIMIT = 120;
export const API_KEY_RATE_WINDOW_MS = 60_000;

/**
 * API-aktøren er en vanlig ServiceActor, men tar også med avdelingsobjektet
 * slik at `/me` kan vise navn uten et ekstra oppslag.
 */
export type ApiActor = ServiceActor & {
  department: { id: string; name: string; isActive: boolean } | null;
};

export type ApiAuthenticationResult =
  | { ok: true; actor: ApiActor; apiKeyId: string }
  | { ok: false; response: NextResponse };

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  departmentId: true,
  customerId: true,
  contactId: true,
  permissions: true,
  permissionsCustomized: true,
  department: { select: { id: true, name: true, isActive: true } },
  roleDefinition: { select: { permissions: true } },
} as const;

/** Henter `Bearer`-tokenet uten å godta andre autentiseringskilder. */
export function apiBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function unauthorized(
  messageKey = "errors.api.apiKey.invalid",
): NextResponse {
  const response = apiError("unauthorized", 401, { messageKey });
  response.headers.set(
    "WWW-Authenticate",
    'Bearer realm="fsm-api", error="invalid_token"',
  );
  return response;
}

/**
 * Autentiserer en API-forespørsel utelukkende med `Authorization: Bearer`.
 *
 * Sesjonscookies brukes aldri her. Nøkkelen må være aktiv, ikke tilbakekalt og
 * ikke utløpt, og brukeren må fortsatt være aktiv. Siste bruk oppdateres, og
 * deretter håndheves en delt grense på 120 kall per minutt per nøkkel.
 */
export async function authenticateApiRequest(
  request: Request,
): Promise<ApiAuthenticationResult> {
  const token = apiBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: unauthorized("errors.api.apiKey.missing"),
    };
  }
  if (!isApiKeyToken(token)) {
    return { ok: false, response: unauthorized() };
  }

  try {
    const key = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKeyToken(token) },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: USER_SELECT },
      },
    });

    const now = new Date();
    if (!key || key.revokedAt) {
      return { ok: false, response: unauthorized() };
    }
    if (
      key.expiresAt &&
      new Date(key.expiresAt).getTime() <= now.getTime()
    ) {
      return { ok: false, response: unauthorized() };
    }
    if (!key.user.isActive) {
      return { ok: false, response: unauthorized() };
    }

    const limit = await allowRequestDb(
      `api-key:${key.id}`,
      API_KEY_RATE_LIMIT,
      API_KEY_RATE_WINDOW_MS,
    );
    if (!limit.allowed) {
      const response = apiError("rate_limited", 429);
      const retryAfterSeconds = Number.isFinite(limit.retryAfterSeconds)
        ? Math.max(0, Math.ceil(limit.retryAfterSeconds))
        : 60;
      response.headers.set("Retry-After", String(retryAfterSeconds));
      return { ok: false, response };
    }

    await prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: now },
      select: { id: true },
    });

    const user = key.user;
    const actor: ApiActor = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      departmentId: user.departmentId,
      department: user.department ?? null,
      customerId: user.customerId,
      contactId: user.contactId,
      permissions: user.permissions,
      permissionsCustomized: user.permissionsCustomized,
      roleDefinition: user.roleDefinition,
    };

    return { ok: true, actor, apiKeyId: key.id };
  } catch {
    return {
      ok: false,
      response: apiError("server_error", 500, {
        messageKey: "errors.api.apiKey.authFailed",
      }),
    };
  }
}
