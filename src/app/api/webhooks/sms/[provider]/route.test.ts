import { beforeEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "@/lib/sms/provider";

const mocks = vi.hoisted(() => ({
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  recordInboundSms: vi.fn(),
}));

vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/messaging", () => ({
  recordInboundSms: mocks.recordInboundSms,
}));

import { POST } from "./route";

const payload = {
  id: "delivery-1",
  from: "4790000000",
  to: "4700000000",
  body: "Hei",
};

function signedRequest(
  body: unknown,
  options: {
    provider?: string;
    signature?: string;
    timestamp?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const rawBody = JSON.stringify(body);
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature =
    options.signature ?? hmacSha256Hex("secret", `${timestamp}.${rawBody}`);
  return new Request(
    `http://localhost/api/webhooks/sms/${options.provider ?? "console"}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sms-timestamp": timestamp,
        "x-sms-signature": signature,
        ...options.headers,
      },
      body: rawBody,
    },
  );
}

function context(provider = "console") {
  return { params: Promise.resolve({ provider }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMS_PROVIDER = "console";
  process.env.SMS_WEBHOOK_SECRET = "secret";
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.recordInboundSms.mockResolvedValue({
    duplicate: false,
    threadId: "thread-1",
    contactId: "contact-1",
    customerId: "customer-1",
    consentAction: null,
  });
});

describe("POST /api/webhooks/sms/[provider]", () => {
  it("avviser ukjent leverandør", async () => {
    const response = await POST(signedRequest(payload), context("ukjent"));
    expect(response.status).toBe(404);
    expect(mocks.recordInboundSms).not.toHaveBeenCalled();
  });

  it("avviser leverandør som ikke er valgt i miljøet", async () => {
    const response = await POST(signedRequest(payload), context("twilio"));
    expect(response.status).toBe(404);
    expect(mocks.recordInboundSms).not.toHaveBeenCalled();
  });

  it("avviser ugyldig signatur uten å lagre", async () => {
    const response = await POST(
      signedRequest(payload, { signature: "feil" }),
      context(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "invalid-signature",
    });
    expect(mocks.recordInboundSms).not.toHaveBeenCalled();
  });

  it("lagrer gyldig levering og svarer leverandørspesifikt", async () => {
    const response = await POST(signedRequest(payload), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      duplicate: false,
      threadId: "thread-1",
    });
    expect(mocks.recordInboundSms).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "console",
        providerId: "delivery-1",
        from: "4790000000",
        body: "Hei",
      }),
    );
  });

  it("svarer ok også når leveringen er en duplikat", async () => {
    mocks.recordInboundSms.mockResolvedValue({
      duplicate: true,
      threadId: null,
      contactId: null,
      customerId: null,
      consentAction: null,
    });

    const response = await POST(signedRequest(payload), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ duplicate: true });
  });

  it("avviser ugyldig JSON etter signaturkontroll", async () => {
    const rawBody = "ikke json";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = hmacSha256Hex("secret", `${timestamp}.${rawBody}`);
    const request = new Request("http://localhost/api/webhooks/sms/console", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sms-timestamp": timestamp,
        "x-sms-signature": signature,
      },
      body: rawBody,
    });

    const response = await POST(request, context());
    expect(response.status).toBe(400);
    expect(mocks.recordInboundSms).not.toHaveBeenCalled();
  });

  it("rate-limiter per leverandør og IP", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });

    const response = await POST(signedRequest(payload), context());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(mocks.recordInboundSms).not.toHaveBeenCalled();
  });

  it("har ingen same-origin-sjekk", async () => {
    const response = await POST(
      signedRequest(payload, {
        headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      }),
      context(),
    );

    expect(response.status).toBe(200);
  });
});
