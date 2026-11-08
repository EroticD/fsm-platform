import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stripeProvider } from "./stripe";
import { vippsProvider, resetVippsTokenCache } from "./vipps";
import {
  getPaymentProvider,
  getPaymentProviderForWebhook,
  paymentProviderInfo,
  resolvePaymentProviderName,
} from "./provider";
import { fromMinorUnits, toMinorUnits } from "./types";

const STRIPE_SECRET = "whsec_test_only";
const VIPPS_SECRET = "vipps-webhook-secret-test";

function stripeRequest(body: string, options: { timestamp?: number; signature?: string } = {}) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature =
    options.signature ??
    crypto.createHmac("sha256", STRIPE_SECRET).update(`${timestamp}.${body}`).digest("hex");
  return {
    rawBody: body,
    headers: new Headers({ "stripe-signature": `t=${timestamp},v1=${signature}` }),
  };
}

function vippsRequest(body: string, options: { date?: string; secret?: string } = {}) {
  const secret = options.secret ?? VIPPS_SECRET;
  const date = options.date ?? new Date().toUTCString();
  const contentHash = crypto.createHash("sha256").update(body, "utf8").digest("base64");
  const url = "https://example.test/api/webhooks/payments/vipps";
  const parsed = new URL(url);
  const signed = `POST\n${parsed.pathname}${parsed.search}\n${date};${parsed.host};${contentHash}`;
  const signature = crypto.createHmac("sha256", secret).update(signed, "utf8").digest("base64");
  return {
    rawBody: body,
    url,
    headers: new Headers({
      "x-ms-date": date,
      "x-ms-content-sha256": contentHash,
      authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetVippsTokenCache();
});

describe("Stripe signatur og webhook", () => {
  it("godtar en gyldig signatur og avviser tukling", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", STRIPE_SECRET);
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    expect(stripeProvider.verifyWebhook(stripeRequest(body))).toBe(true);
    expect(
      stripeProvider.verifyWebhook({ ...stripeRequest(body), rawBody: `${body} ` }),
    ).toBe(false);
  });

  it("avviser gamle signaturer", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", STRIPE_SECRET);
    const body = "{}";
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(stripeProvider.verifyWebhook(stripeRequest(body, { timestamp: old }))).toBe(false);
  });

  it("parser fullført Checkout Session med stabil betalings-id", () => {
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      created: 1_700_000_000,
      data: {
        object: {
          id: "cs_1",
          payment_intent: "pi_1",
          payment_status: "paid",
          amount_total: 125000,
          currency: "nok",
          metadata: { invoiceId: "inv_1" },
        },
      },
    });
    const event = stripeProvider.parseWebhook({ rawBody: body, headers: new Headers() });
    expect(event).toMatchObject({
      eventId: "evt_1",
      providerPaymentId: "pi_1",
      outcome: "PAID",
      invoiceId: "inv_1",
      amount: "1250.00",
      currency: "NOK",
    });
  });

  it("behandler refusjon som ignorert – refusjon skjer via kreditnota", () => {
    const body = JSON.stringify({
      id: "evt_refund",
      type: "charge.refunded",
      data: { object: { id: "ch_1", currency: "nok", metadata: { invoiceId: "inv_1" } } },
    });
    const event = stripeProvider.parseWebhook({ rawBody: body, headers: new Headers() });
    expect(event?.outcome).toBe("IGNORED");
  });
});

describe("Vipps MobilePay signatur og webhook", () => {
  it("godtar Vipps HMAC-oppsett og avviser feil hemmelighet", () => {
    vi.stubEnv("VIPPS_WEBHOOK_SECRET", VIPPS_SECRET);
    const body = JSON.stringify({ id: "evt_1" });
    expect(vippsProvider.verifyWebhook(vippsRequest(body))).toBe(true);
    expect(
      vippsProvider.verifyWebhook(vippsRequest(body, { secret: "feil-hemmelighet" })),
    ).toBe(false);
  });

  it("avviser feil innholdshash og gamle tidsstempler", () => {
    vi.stubEnv("VIPPS_WEBHOOK_SECRET", VIPPS_SECRET);
    const body = "{}";
    const request = vippsRequest(body);
    request.headers.set("x-ms-content-sha256", "feil");
    expect(vippsProvider.verifyWebhook(request)).toBe(false);

    const old = vippsRequest(body, { date: new Date(Date.now() - 400_000).toUTCString() });
    expect(vippsProvider.verifyWebhook(old)).toBe(false);
  });

  it("parser epayment.succeeded til en betaling i øre", () => {
    const body = JSON.stringify({
      id: "evt_1",
      timestamp: "2026-11-09T09:00:00Z",
      type: "epayment.succeeded",
      data: {
        reference: "fsm-inv_1",
        pspReference: "psp_1",
        amount: { value: 99900, currency: "NOK" },
      },
    });
    const event = vippsProvider.parseWebhook({ rawBody: body, headers: new Headers() });
    expect(event).toMatchObject({
      eventId: "evt_1",
      providerPaymentId: "psp_1",
      outcome: "PAID",
      invoiceId: "inv_1",
      amount: "999.00",
      currency: "NOK",
    });
  });

  it("parser failed og expired uten å lage betaling", () => {
    const failed = vippsProvider.parseWebhook({
      rawBody: JSON.stringify({
        id: "evt_f",
        type: "epayment.failed",
        data: { reference: "fsm-inv_2", amount: { value: 100, currency: "NOK" } },
      }),
      headers: new Headers(),
    });
    const expired = vippsProvider.parseWebhook({
      rawBody: JSON.stringify({
        id: "evt_e",
        type: "epayment.expired",
        data: { reference: "fsm-inv_2", amount: { value: 100, currency: "NOK" } },
      }),
      headers: new Headers(),
    });
    expect(failed?.outcome).toBe("FAILED");
    expect(expired?.outcome).toBe("EXPIRED");
  });
});

describe("leverandørvalg og beløp", () => {
  it("er en stille no-op når betaling ikke er konfigurert", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    expect(resolvePaymentProviderName()).toBeNull();
    expect(getPaymentProvider()).toBeNull();
    expect(getPaymentProviderForWebhook("stripe")).toBeNull();
    expect(paymentProviderInfo()).toMatchObject({ provider: null, configured: false });
  });

  it("velger bare den konfigurerte leverandøren", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "vipps");
    expect(resolvePaymentProviderName()).toBe("vipps");
    expect(getPaymentProviderForWebhook("stripe")).toBeNull();
    expect(getPaymentProviderForWebhook("vipps")?.name).toBe("vipps");
  });

  it("regner om beløp uten flyttall", () => {
    expect(toMinorUnits("1250.50")).toBe(125050);
    expect(toMinorUnits("0.01")).toBe(1);
    expect(toMinorUnits(10)).toBe(1000);
    expect(fromMinorUnits(125050)).toBe("1250.50");
    expect(fromMinorUnits(1)).toBe("0.01");
  });
});
