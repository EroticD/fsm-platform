// i18n-ignore-file: leverandørfeil er driftsdata, ikke UI-tekst.
import crypto from "node:crypto";
import {
  PaymentProviderError,
  fromMinorUnits,
  normalizeCurrency,
  toMinorUnits,
  type PaymentLink,
  type PaymentLinkRequest,
  type PaymentProvider,
  type PaymentStatusResult,
  type PaymentWebhookEvent,
  type PaymentWebhookRequest,
} from "./types";

/**
 * Stripe Checkout som betalingslenke.
 *
 * Vi bruker Checkout Session fordi kortdata da aldri berører vår app. Webhooken
 * verifiseres med `Stripe-Signature` (HMAC-SHA256 over `t.rawBody`) og en
 * tidsbegrensning på fem minutter. Se docs/PAYMENTS.md.
 */

const API_BASE = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15_000;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function secretKey(): string {
  return env("STRIPE_SECRET_KEY");
}

function webhookSecret(): string {
  return env("STRIPE_WEBHOOK_SECRET");
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function appUrl(): string {
  return (
    env("APP_URL") ||
    env("NEXTAUTH_URL") ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

async function stripeRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const key = secretKey();
  if (!key) throw new PaymentProviderError("Stripe is not configured", "not_configured");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PaymentProviderError("Stripe request failed", "provider_error", true);
  }
  if (response.status === 429) {
    throw new PaymentProviderError("Stripe rate limited", "rate_limited", true);
  }
  if (!response.ok) {
    throw new PaymentProviderError("Stripe rejected the request", "provider_error", response.status >= 500);
  }
  return response;
}

function formBody(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  return params.toString();
}

type StripeEvent = {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: Record<string, unknown> };
};

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function invoiceIdFrom(object: Record<string, unknown>): string | null {
  const metadata = objectOf(object.metadata);
  return (
    stringOf(metadata?.invoiceId) ??
    stringOf(object.client_reference_id) ??
    null
  );
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",

  configured(): boolean {
    return Boolean(secretKey() && webhookSecret());
  },

  async createPaymentLink(input: PaymentLinkRequest): Promise<PaymentLink> {
    const amount = toMinorUnits(input.amount);
    if (amount <= 0) throw new PaymentProviderError("Invalid amount", "invalid_payload");
    const currency = normalizeCurrency(input.currency).toLowerCase();
    const returnUrl = input.returnUrl || `${appUrl()}/kundeportal/faktura/${input.invoiceId}`;

    const response = await stripeRequest("/checkout/sessions", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: formBody({
        mode: "payment",
        success_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}payment=success`,
        cancel_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}payment=cancelled`,
        client_reference_id: input.invoiceId,
        "metadata[invoiceId]": input.invoiceId,
        "metadata[invoiceNumber]": input.invoiceNumber ?? "",
        "payment_intent_data[metadata][invoiceId]": input.invoiceId,
        "customer_email": input.customerEmail ?? undefined,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": currency,
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][price_data][product_data][name]":
          input.description.slice(0, 120) || "Faktura",
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const url = stringOf(body?.url);
    const id = stringOf(body?.id);
    if (!body || !url || !id) {
      throw new PaymentProviderError("Stripe returned no checkout URL", "provider_error", true);
    }
    return { provider: "stripe", providerId: id, url, status: "PENDING" };
  },

  verifyWebhook(request: PaymentWebhookRequest): boolean {
    const secret = webhookSecret();
    if (!secret) return false;
    const header = request.headers.get("stripe-signature")?.trim() ?? "";
    if (!header) return false;

    let timestamp = "";
    const signatures: string[] = [];
    for (const part of header.split(",")) {
      const [key, value] = part.split("=", 2);
      if (key === "t") timestamp = value ?? "";
      if (key === "v1" && value) signatures.push(value);
    }
    if (!timestamp || signatures.length === 0) return false;
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds)) return false;
    if (Math.abs(Date.now() / 1000 - seconds) > SIGNATURE_TOLERANCE_SECONDS) {
      return false;
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${request.rawBody}`, "utf8")
      .digest("hex");
    return signatures.some((signature) => safeEqualHex(expected, signature));
  },

  parseWebhook(request: PaymentWebhookRequest): PaymentWebhookEvent | null {
    let event: StripeEvent;
    try {
      event = JSON.parse(request.rawBody) as StripeEvent;
    } catch {
      return null;
    }
    const type = event.type ?? "";
    const object = objectOf(event.data?.object);
    if (!object || !event.id) return null;

    const base = {
      provider: "stripe" as const,
      eventId: event.id,
      eventType: type,
      paidAt: event.created ? new Date(event.created * 1000) : new Date(),
    };

    if (type === "checkout.session.completed") {
      const invoiceId = invoiceIdFrom(object);
      if (String(object.payment_status ?? "") !== "paid") {
        return {
          ...base,
          providerPaymentId: stringOf(object.payment_intent) ?? stringOf(object.id) ?? event.id,
          outcome: "IGNORED",
          invoiceId,
          reference: null,
          amount: fromMinorUnits(object.amount_total),
          currency: normalizeCurrency(object.currency),
          failureReason: "not_paid",
        };
      }
      return {
        ...base,
        providerPaymentId:
          stringOf(object.payment_intent) ?? stringOf(object.id) ?? event.id,
        outcome: "PAID",
        invoiceId,
        reference: null,
        amount: fromMinorUnits(object.amount_total),
        currency: normalizeCurrency(object.currency),
        failureReason: null,
      };
    }

    if (type === "payment_intent.succeeded") {
      return {
        ...base,
        providerPaymentId: stringOf(object.id) ?? event.id,
        outcome: "PAID",
        invoiceId: invoiceIdFrom(object),
        reference: null,
        amount: fromMinorUnits(object.amount_received ?? object.amount),
        currency: normalizeCurrency(object.currency),
        failureReason: null,
      };
    }

    if (type === "checkout.session.expired") {
      return {
        ...base,
        providerPaymentId: stringOf(object.payment_intent) ?? stringOf(object.id) ?? event.id,
        outcome: "EXPIRED",
        invoiceId: invoiceIdFrom(object),
        reference: null,
        amount: fromMinorUnits(object.amount_total),
        currency: normalizeCurrency(object.currency),
        failureReason: "expired",
      };
    }

    if (type === "payment_intent.payment_failed") {
      const error = objectOf(object.last_payment_error);
      return {
        ...base,
        providerPaymentId: stringOf(object.id) ?? event.id,
        outcome: "FAILED",
        invoiceId: invoiceIdFrom(object),
        reference: null,
        amount: fromMinorUnits(object.amount),
        currency: normalizeCurrency(object.currency),
        failureReason: stringOf(error?.code) ?? "payment_failed",
      };
    }

    // Refusjoner håndteres med kreditnota i v1. Vi registrerer ingen
    // negativ betaling fra en PSP-hendelse.
    return {
      ...base,
      providerPaymentId: stringOf(object.id) ?? event.id,
      outcome: "IGNORED",
      invoiceId: invoiceIdFrom(object),
      reference: null,
      amount: "0.00",
      currency: normalizeCurrency(object.currency),
      failureReason: "unsupported_event",
    };
  },

  async getStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const id = providerPaymentId.trim();
    if (!id) throw new PaymentProviderError("Missing id", "invalid_payload");
    const path = id.startsWith("cs_")
      ? `/checkout/sessions/${encodeURIComponent(id)}`
      : `/payment_intents/${encodeURIComponent(id)}`;
    const response = await stripeRequest(path, { method: "GET" });
    const body = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) throw new PaymentProviderError("Empty Stripe response", "provider_error", true);
    const paid = body.payment_status === "paid" || body.status === "succeeded";
    const failed = body.status === "canceled";
    return {
      provider: "stripe",
      providerId: id,
      status: paid ? "PAID" : failed ? "FAILED" : "PENDING",
      amount: fromMinorUnits(body.amount_total ?? body.amount_received ?? body.amount),
      currency: normalizeCurrency(body.currency),
    };
  },
};
