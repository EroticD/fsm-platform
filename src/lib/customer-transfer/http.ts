// i18n-ignore-file: HTTP-hjelpere bruker stabile feilkoder, ikke UI-tekst.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { canUseCustomerTransfer, toTransferActor } from "./guard";
import type { ServiceActor } from "@/server/actor";
import type { TransferFailure } from "@/server/customer-transfer";

export const TRANSFER_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

export function transferJson(
  body: unknown,
  init: ResponseInit = {},
): NextResponse {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(TRANSFER_HEADERS)) {
    headers.set(key, value);
  }
  return NextResponse.json(body, { ...init, headers });
}

export function transferFailureResponse(failure: TransferFailure): NextResponse {
  return transferJson(
    {
      error: failure.code,
      messageKey: failure.messageKey,
      ...(failure.errors ? { errors: failure.errors.slice(0, 500) } : {}),
    },
    { status: failure.status },
  );
}

type GuardResult =
  | { ok: true; actor: ServiceActor }
  | { ok: false; response: NextResponse };

/** Reautoriserer hver rute. Skjulte knapper er ikke tilgangskontroll. */
export async function guardTransferRoute(): Promise<GuardResult> {
  const user = await getCurrentUser();
  if (!user || !canUseCustomerTransfer(user)) {
    return {
      ok: false,
      response: transferFailureResponse({
        ok: false,
        status: 403,
        code: "customer_transfer.forbidden",
        messageKey: "errors.customerTransfer.forbidden",
      }),
    };
  }
  return { ok: true, actor: toTransferActor(user) };
}

export function requireSameOrigin(request: Request): NextResponse | null {
  if (assertSameOrigin(request)) return null;
  return transferFailureResponse({
    ok: false,
    status: 403,
    code: "invalid_origin",
    messageKey: "errors.api.invalidOrigin",
  });
}

export async function transferRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const result = await allowRequestDb(key, limit, windowMs);
  if (result.allowed) return null;
  return transferJson(
    {
      error: "customer_transfer.rate_limited",
      messageKey: "errors.customerTransfer.rateLimited",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    },
  );
}

export function methodNotAllowed(): NextResponse {
  return transferJson(
    {
      error: "invalid_request",
      messageKey: "errors.api.invalidRequest",
    },
    { status: 405 },
  );
}
