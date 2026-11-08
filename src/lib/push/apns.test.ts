import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apnsHost,
  buildApnsJwt,
  buildApnsPayload,
  createApnsProvider,
  resetApnsJwtCacheForTests,
} from "./apns";
import { decodeJwtPart } from "./jwt";
import type { ApnsConfig } from "./config";

function apns(): { config: ApnsConfig; publicKey: crypto.KeyObject } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return {
    config: {
      keyP8: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      keyId: "ABC123DEFG",
      teamId: "TEAM123456",
      bundleId: "no.example.fsm",
      environment: "sandbox",
    },
    publicKey,
  };
}

afterEach(() => {
  resetApnsJwtCacheForTests();
});

describe("APNs token-basert autentisering", () => {
  it("signerer ES256-JWT i JOSE-format", () => {
    const { config, publicKey } = apns();
    const jwt = buildApnsJwt(config, 1_700_000_000);
    const [headerPart, claimsPart, signaturePart] = jwt.split(".");
    expect(decodeJwtPart(headerPart)).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
      typ: "JWT",
    });
    expect(decodeJwtPart(claimsPart)).toEqual({
      iss: "TEAM123456",
      iat: 1_700_000_000,
    });
    expect(
      crypto.verify(
        "sha256",
        Buffer.from(`${headerPart}.${claimsPart}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signaturePart, "base64url"),
      ),
    ).toBe(true);
  });

  it("velger sandbox-vert og bygger payload med dyp lenke", () => {
    const { config } = apns();
    expect(apnsHost(config)).toBe("api.sandbox.push.apple.com");
    expect(
      buildApnsPayload({
        token: "abc",
        title: "Faktura betalt",
        body: "Faktura 123 er betalt.",
        path: "/faktura/inv1",
        notificationId: "n1",
        type: "INVOICE_PAID",
      }),
    ).toMatchObject({
      aps: {
        alert: { title: "Faktura betalt", body: "Faktura 123 er betalt." },
        sound: "default",
      },
      type: "INVOICE_PAID",
      path: "/faktura/inv1",
      notificationId: "n1",
    });
  });

  it("sender med riktige headere og mock fetch", async () => {
    const { config } = apns();
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "apns-id": "apns-42" },
        }),
    );

    const provider = createApnsProvider(config, fetchMock);
    const result = await provider.send({
      token: "abc123def456",
      title: "Test",
      body: "Hei",
      path: "/varsler",
      notificationId: "n1",
      type: "TEST",
    });

    expect(result).toEqual({ status: "sent", providerId: "apns-42" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.sandbox.push.apple.com/3/device/abc123def456");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(headers["apns-topic"]).toBe("no.example.fsm");
    expect(headers["apns-push-type"]).toBe("alert");
    expect(JSON.parse(String(init.body))).toMatchObject({
      path: "/varsler",
      notificationId: "n1",
      aps: { alert: { title: "Test" } },
    });
  });

  it("mapper BadDeviceToken til invalid_token", async () => {
    const { config } = apns();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ reason: "BadDeviceToken" }), {
          status: 400,
        }),
    );

    const provider = createApnsProvider(config, fetchMock);
    await expect(
      provider.send({
        token: "abc123def456",
        title: "Test",
        body: null,
        path: null,
        notificationId: null,
        type: "TEST",
      }),
    ).resolves.toMatchObject({
      status: "failed",
      code: "invalid_token",
      retryable: false,
      httpStatus: 400,
    });
  });

  it("gjør ingen nettverkskall uten konfigurasjon", async () => {
    const fetchMock = vi.fn();
    const provider = createApnsProvider(null, fetchMock);
    await expect(
      provider.send({
        token: "abc123def456",
        title: "Test",
        body: null,
        path: null,
        notificationId: null,
        type: "TEST",
      }),
    ).resolves.toEqual({ status: "skipped", code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
