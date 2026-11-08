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
 * Vipps MobilePay ePayment.
 *
 * «Betal med Vipps»-flyten oppretter en betaling med `userFlow=WEB_REDIRECT` og
 * returnerer `redirectUrl`. Vi lagrer bare referansen og URL-en.
 *
 * Webhooken bruker Vipps MobilePays HMAC-oppsett: `x-ms-date`,
 * `x-ms-content-sha256` og `Authorization: HMAC-SHA256 SignedHeaders=...`.
 * Signaturen dekker method, path+query og de tre header-verdiene. Se
 * docs/PAYMENTS.md.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function baseUrl(): string {
  return (env("VIPPS_BASE_URL") || "https://apitest.vipps.no").replace(/\/$/, "");
}

function webhookSecret(): string {
  return env("VIPPS_WEBHOOK_SECRET");
}

function merchantSerialNumber(): string {
  return env("VIPPS_MERCHANT_SERIAL_NUMBER");
}

function appUrl(): string {
  return (
    env("APP_URL") ||
    env("NEXTAUTH_URL") ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function vippsConfigured(): boolean {
  return Boolean(
    env("VIPPS_CLIENT_ID") &&
      env("VIPPS_CLIENT_SECRET") &&
      env("VIPPS_SUBSCRIPTION_KEY") &&
      merchantSerialNumber(),
  );
}

async function accessToken(): Promise<string> {
  if (!vippsConfigured()) {
    throw new PaymentProviderError("Vipps is not configured", "not_configured");
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.token;
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/accessToken/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        client_id: env("VIPPS_CLIENT_ID"),
        client_secret: env("VIPPS_CLIENT_SECRET"),
        "Ocp-Apim-Subscription-Key": env("VIPPS_SUBSCRIPTION_KEY"),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PaymentProviderError("Vipps token request failed", "provider_error", true);
  }
  if (!response.ok) {
    throw new PaymentProviderError(
      "Vipps rejected the token request",
      "provider_error",
      response.status >= 500 || response.status === 429,
    );
  }
  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!body?.access_token) {
    throw new PaymentProviderError("Vipps returned no token", "provider_error", true);
  }
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
  };
  return body.access_token;
}

function vippsHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Ocp-Apim-Subscription-Key": env("VIPPS_SUBSCRIPTION_KEY"),
    "Merchant-Serial-Number": merchantSerialNumber(),
    "Vipps-System-Name": env("VIPPS_SYSTEM_NAME") || "fsm-platform",
    "Vipps-System-Version": env("VIPPS_SYSTEM_VERSION") || "1.0.0",
    "Content-Type": "application/json",
  };
}

function safeEqualBase64(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

type VippsEvent = {
  id?: string;
  timestamp?: string;
  type?: string;
  data?: Record<string, unknown>;
};

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function amountOf(value: unknown): { value: unknown; currency: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: 0, currency: "" };
  }
  const amount = value as Record<string, unknown>;
  return { value: amount.value, currency: amount.currency };
}

function invoiceIdFromReference(reference: string | null): string | null {
  if (!reference) return null;
  return reference.startsWith("fsm-") ? reference.slice(4) : reference;
}

export const vippsProvider: PaymentProvider = {
  name: "vipps",

  configured(): boolean {
    return vippsConfigured() && Boolean(webhookSecret());
  },

  async createPaymentLink(input: PaymentLinkRequest): Promise<PaymentLink> {
    const amount = toMinorUnits(input.amount);
    if (amount <= 0) throw new PaymentProviderError("Invalid amount", "invalid_payload");
    const reference = `fsm-${input.invoiceId}`.slice(0, 50);
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetch(`${baseUrl()}/epayment/v1/payments`, {
        method: "POST",
        headers: {
          ...vippsHeaders(token),
          "Idempotency-Key": input.idempotencyKey.slice(0, 50),
        },
        body: JSON.stringify({
          amount: { value: amount, currency: normalizeCurrency(input.currency) },
          paymentMethod: { type: "WALLET" },
          reference,
          paymentDescription: input.description.slice(0, 100) || "Faktura",
          returnUrl:
            input.returnUrl ||
            `${appUrl()}/kundeportal/faktura/${input.invoiceId}`,
          userFlow: "WEB_REDIRECT",
          ...(input.customerPhone ? { customer: { phoneNumber: input.customerPhone } } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new PaymentProviderError("Vipps payment request failed", "provider_error", true);
    }
    if (response.status === 429) {
      throw new PaymentProviderError("Vipps rate limited", "rate_limited", true);
    }
    if (!response.ok) {
      throw new PaymentProviderError(
        "Vipps rejected the payment request",
        "provider_error",
        response.status >= 500,
      );
    }
    const body = (await response.json().catch(() => null)) as
      | { redirectUrl?: string; reference?: string }
      | null;
    if (!body?.redirectUrl) {
      throw new PaymentProviderError("Vipps returned no redirect URL", "provider_error", true);
    }
    return {
      provider: "vipps",
      providerId: body.reference ?? reference,
      url: body.redirectUrl,
      status: "PENDING",
    };
  },

  verifyWebhook(request: PaymentWebhookRequest): boolean {
    const secret = webhookSecret();
    if (!secret) return false;
    const date = request.headers.get("x-ms-date")?.trim() ?? "";
    const contentHash = request.headers.get("x-ms-content-sha256")?.trim() ?? "";
    const authorization = request.headers.get("authorization")?.trim() ?? "";
    if (!date || !contentHash || !authorization) return false;

    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(Date.now() - timestamp) > SIGNATURE_TOLERANCE_SECONDS * 1000) {
      return false;
    }

    const expectedContentHash = crypto
      .createHash("sha256")
      .update(request.rawBody, "utf8")
      .digest("base64");
    if (!safeEqualBase64(expectedContentHash, contentHash)) return false;

    let pathAndQuery = "/";
    let host = request.headers.get("host")?.trim() ?? "";
    if (request.url) {
      try {
        const parsed = new URL(request.url);
        pathAndQuery = `${parsed.pathname}${parsed.search}`;
        host = host || parsed.host;
      } catch {
        return false;
      }
    }
    if (!host) return false;

    const signed =
      `${request.headers.get("x-forwarded-method") ?? "POST"}\n` +
      `${pathAndQuery}\n` +
      `${date};${host};${contentHash}`;
    const signature = crypto
      .createHmac("sha256", secret)
      .update(signed, "utf8")
      .digest("base64");
    const expected = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`;
    return safeEqualBase64(expected, authorization);
  },

  parseWebhook(request: PaymentWebhookRequest): PaymentWebhookEvent | null {
    let event: VippsEvent;
    try {
      event = JSON.parse(request.rawBody) as VippsEvent;
    } catch {
      return null;
    }
    const data = event.data;
    if (!event.id || !data) return null;
    const type = event.type ?? "";
    const reference = stringOf(data.reference);
    const amount = amountOf(data.amount);
    const providerPaymentId =
      stringOf(data.pspReference) ??
      stringOf(data.paymentId) ??
      reference ??
      event.id;
    const base = {
      provider: "vipps" as const,
      eventId: event.id,
      providerPaymentId,
      invoiceId: invoiceIdFromReference(reference),
      reference,
      amount: fromMinorUnits(amount.value),
      currency: normalizeCurrency(amount.currency),
      paidAt: event.timestamp && Number.isFinite(Date.parse(event.timestamp))
        ? new Date(event.timestamp)
        : new Date(),
      eventType: type,
    };

    if (type === "epayment.succeeded" || type === "epayment.captured") {
      return { ...base, outcome: "PAID", failureReason: null };
    }
    if (
      type === "epayment.failed" ||
      type === "epayment.aborted" ||
      type === "epayment.cancelled"
    ) {
      return { ...base, outcome: "FAILED", failureReason: type };
    }
    if (type === "epayment.expired") {
      return { ...base, outcome: "EXPIRED", failureReason: type };
    }
    return { ...base, outcome: "IGNORED", failureReason: "unsupported_event" };
  },

  async getStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const reference = providerPaymentId.trim();
    if (!reference) throw new PaymentProviderError("Missing id", "invalid_payload");
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetch(
        `${baseUrl()}/epayment/v1/payments/${encodeURIComponent(reference)}`,
        {
          method: "GET",
          headers: vippsHeaders(token),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new PaymentProviderError("Vipps status request failed", "provider_error", true);
    }
    if (!response.ok) {
      throw new PaymentProviderError(
        "Vipps rejected the status request",
        "provider_error",
        response.status >= 500,
      );
    }
    const body = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) throw new PaymentProviderError("Empty Vipps response", "provider_error", true);
    const amount = amountOf(body.amount);
    const state = String(body.state ?? "").toUpperCase();
    const status =
      state === "CAPTURED" || state === "AUTHORIZED"
        ? "PAID"
        : state === "TERMINATED" || state === "ABORTED"
          ? "FAILED"
          : state === "EXPIRED"
            ? "EXPIRED"
            : "PENDING";
    return {
      provider: "vipps",
      providerId: reference,
      status,
      amount: fromMinorUnits(amount.value),
      currency: normalizeCurrency(amount.currency),
    };
  },
};

/** Nullstiller token-cachen. Brukes av tester. */
export function resetVippsTokenCache(): void {
  tokenCache = null;
}
