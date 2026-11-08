import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleApiGuard: vi.fn(async (): Promise<Response | null> => null),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  applyPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/module-guards", () => ({ moduleApiGuard: mocks.moduleApiGuard }));
vi.mock("@/lib/rate-limit-db", () => ({ allowRequestDb: mocks.allowRequestDb }));
vi.mock("@/server/payments", () => ({ applyPaymentEvent: mocks.applyPaymentEvent }));

import { POST } from "./route";

const WEBHOOK_SECRET = "whsec_route_test";
const BODY = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  created: 1_700_000_000,
  data: {
    object: {
      id: "cs_1",
      payment_intent: "pi_1",
      payment_status: "paid",
      amount_total: 10000,
      currency: "nok",
      metadata: { invoiceId: "inv_1" },
    },
  },
});

function request(options: { body?: string; signature?: string; provider?: string; headers?: Record<string, string> } = {}) {
  const body = options.body ?? BODY;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    options.signature ??
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
  return new Request(
    `http://localhost/api/webhooks/payments/${options.provider ?? "stripe"}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`,
        ...options.headers,
      },
      body,
    },
  );
}

function context(provider = "stripe") {
  return { params: Promise.resolve({ provider }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYMENTS_PROVIDER = "stripe";
  process.env.STRIPE_SECRET_KEY = "sk_test_route";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  mocks.moduleApiGuard.mockResolvedValue(null);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.applyPaymentEvent.mockResolvedValue({
    outcome: "payment",
    invoiceId: "inv_1",
    paymentId: "pay_1",
    reason: null,
  });
});

afterEach(() => {
  delete process.env.PAYMENTS_PROVIDER;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/payments/[provider]", () => {
  it("gir 404 når invoicing-modulen er av", async () => {
    mocks.moduleApiGuard.mockResolvedValue(
      NextResponse.json({ error: "not_found" }, { status: 404 }),
    );
    const response = await POST(request(), context());
    expect(response.status).toBe(404);
    expect(mocks.applyPaymentEvent).not.toHaveBeenCalled();
  });

  it("gir 404 for leverandør som ikke er valgt", async () => {
    const response = await POST(request(), context("vipps"));
    expect(response.status).toBe(404);
  });

  it("gir 503 når valgt leverandør mangler konfigurasjon", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "payments-not-configured" });
  });

  it("avviser ugyldig signatur uten å lagre", async () => {
    const response = await POST(request({ signature: "feil" }), context());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "invalid-signature" });
    expect(mocks.applyPaymentEvent).not.toHaveBeenCalled();
  });

  it("anvender gyldig signert hendelse", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, outcome: "payment" });
    expect(mocks.applyPaymentEvent).toHaveBeenCalledWith(
      "stripe",
      expect.objectContaining({ invoiceId: "inv_1", outcome: "PAID" }),
    );
  });

  it("svarer 200 når hendelsen er en duplikat", async () => {
    mocks.applyPaymentEvent.mockResolvedValue({
      outcome: "duplicate",
      invoiceId: "inv_1",
      paymentId: "pay_1",
      reason: null,
    });
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ duplicate: true });
  });

  it("rate-limiter per leverandør og IP", async () => {
    mocks.allowRequestDb.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const response = await POST(request(), context());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(mocks.applyPaymentEvent).not.toHaveBeenCalled();
  });

  it("avviser for stor kropp før signaturkontroll", async () => {
    const response = await POST(
      request({ headers: { "content-length": "100000" } }),
      context(),
    );
    expect(response.status).toBe(413);
    expect(mocks.applyPaymentEvent).not.toHaveBeenCalled();
  });

  it("lekker ingen interne detaljer når lagringen feiler", async () => {
    mocks.applyPaymentEvent.mockRejectedValue(new Error("database secret"));
    const response = await POST(request(), context());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal" });
  });
});
