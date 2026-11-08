import { NextResponse } from "next/server";
import { clientIpFrom } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import { moduleApiGuard } from "@/lib/module-guards";
import {
  getPaymentProviderForWebhook,
} from "@/lib/payments/provider";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { readTextWithLimit } from "@/lib/request-body";
import { applyPaymentEvent } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PSP-webhooker er små. Større kropper avvises før signaturkontroll. */
const WEBHOOK_BODY_LIMIT = 64 * 1024;
const WEBHOOK_RATE_LIMIT = 120;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function errorResponse(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE });
}

/**
 * Signerte betalingswebhooker fra Stripe eller Vipps MobilePay.
 *
 * Ruten har ingen same-origin-sjekk: leverandøren er ikke en nettleser.
 * Autentiseringen er HMAC-signaturen over rå kropp. Modulvakten gir 404 når
 * `invoicing` er av, og en leverandør som ikke er valgt i miljøet gir også 404
 * uten å røpe konfigurasjonen. Ved intern feil svarer vi 500 slik at
 * leverandøren prøver igjen; idempotensen gjør ny levering trygg.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const moduleGuard = await moduleApiGuard("invoicing");
  if (moduleGuard) return moduleGuard;

  const { provider: providerParam } = await context.params;
  const provider = getPaymentProviderForWebhook(providerParam);
  if (!provider) return errorResponse("invalid-provider", 404);
  if (!provider.configured()) {
    return errorResponse("payments-not-configured", 503);
  }

  const ip = clientIpFrom(request.headers) ?? "unknown";
  const limit = await allowRequestDb(
    `payments-webhook:${providerParam}:${ip}`,
    WEBHOOK_RATE_LIMIT,
    WEBHOOK_RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate-limited" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const raw = await readTextWithLimit(request, WEBHOOK_BODY_LIMIT);
  if (!raw.ok) {
    return errorResponse(
      raw.status === 413 ? "payload-too-large" : "invalid-payload",
      raw.status,
    );
  }

  if (
    !provider.verifyWebhook({
      rawBody: raw.data,
      headers: request.headers,
      url: request.url,
    })
  ) {
    return errorResponse("invalid-signature", 403);
  }

  const event = provider.parseWebhook({
    rawBody: raw.data,
    headers: request.headers,
    url: request.url,
  });
  if (!event) return errorResponse("invalid-payload", 400);

  try {
    const result = await applyPaymentEvent(provider.name, event);
    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        duplicate: result.outcome === "duplicate",
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // Logg aldri rå payload, faktura-id, beløp eller persondata.
    logger.error("Payment webhook failed", {
      provider: providerParam,
      eventType: event.eventType,
      error: error instanceof Error ? error.name : "unknown",
    });
    return errorResponse("internal", 500);
  }
}
