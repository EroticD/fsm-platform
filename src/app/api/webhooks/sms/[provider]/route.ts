import { NextResponse } from "next/server";
import { clientIpFrom } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { readTextWithLimit } from "@/lib/request-body";
import {
  getSmsProvider,
  resolveSmsProviderName,
  SMS_PROVIDERS,
  type SmsProviderName,
} from "@/lib/sms/provider";
import { recordInboundSms, type InboundSmsResult } from "@/server/messaging";
import { applySmsStatusUpdate } from "@/server/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leverandørwebhooker er små; større kropper avvises før signaturkontroll. */
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
 * Providersvar. Twilio forventer XML, PSWinCom leser en kort tekst, og
 * Link Mobility godtar JSON. Uansett svarer vi «ok» også for en duplikatlevering,
 * slik at leverandøren slutter å prøve på nytt.
 */
function successResponse(
  provider: SmsProviderName,
  result: InboundSmsResult | { status: "updated" | "ignored" | "unknown" },
) {
  const delivery =
    "status" in result ? { delivery: result.status } : { duplicate: result.duplicate };
  if (provider === "twilio") {
    return new NextResponse("<Response></Response>", {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": "text/xml; charset=utf-8" },
    });
  }
  if (provider === "pswincom") {
    return new NextResponse("OK", {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (provider === "linkmobility") {
    return NextResponse.json(
      { status: "OK", ...delivery },
      { status: 200, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      ...("status" in result
        ? delivery
        : {
            duplicate: result.duplicate,
            threadId: result.threadId,
            consentAction: result.consentAction,
          }),
    },
    { status: 200, headers: NO_STORE },
  );
}

function isProvider(value: string): value is SmsProviderName {
  return (SMS_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Innkommende SMS fra leverandøren.
 *
 * Ruten er bevisst uten same-origin-sjekk: leverandøren er ikke en nettleser.
 * I stedet kreves gyldig HMAC-signatur (eller Twilio-signatur), og hver
 * levering er idempotent via `SmsMessage(provider, providerId)`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: providerParam } = await context.params;
  if (!isProvider(providerParam)) {
    return errorResponse("invalid-provider", 404);
  }

  // Bare den konfigurerte leverandøren får levere. Det hindrer at en gammel
  // eller feilkonfigurert integrasjon skriver inn meldinger.
  if (providerParam !== resolveSmsProviderName()) {
    return errorResponse("invalid-provider", 404);
  }

  const ip = clientIpFrom(request.headers) ?? "unknown";
  const limit = await allowRequestDb(
    `sms-webhook:${providerParam}:${ip}`,
    WEBHOOK_RATE_LIMIT,
    WEBHOOK_RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate-limited" },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(limit.retryAfterSeconds),
        },
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

  const provider = getSmsProvider(providerParam);
  if (
    !provider.verifySignature({
      rawBody: raw.data,
      headers: request.headers,
      url: request.url,
    })
  ) {
    return errorResponse("invalid-signature", 403);
  }

  // Leverandørene bruker samme endepunkt for leveringsstatus. En
  // statuscallback har ingen avsender/tekst, og skal besvares med 200 også
  // når vi ikke kjenner meldings-ID-en – ellers prøver leverandøren evig.
  // Status prøves først, slik at en leveringskvittering aldri blir lagret som
  // en ny innkommende melding.
  try {
    const status = provider.parseStatus({
      rawBody: raw.data,
      headers: request.headers,
      url: request.url,
    });
    if (status) {
      const applied = await applySmsStatusUpdate(status);
      return successResponse(providerParam, { status: applied });
    }

    const inbound = provider.parseWebhook({
      rawBody: raw.data,
      headers: request.headers,
      url: request.url,
    });
    if (!inbound) return errorResponse("invalid-payload", 400);

    const result = await recordInboundSms(inbound);
    return successResponse(providerParam, result);
  } catch (error) {
    // Svar aldri med stack traces eller leverandørpayload. Leverandøren prøver
    // igjen, og idempotensen gjør en ny levering trygg.
    logger.error("SMS webhook failed", {
      provider: providerParam,
      error: error instanceof Error ? error.name : "unknown",
    });
    return errorResponse("internal", 500);
  }
}
