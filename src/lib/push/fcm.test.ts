import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFcmAssertion,
  buildFcmMessage,
  createFcmProvider,
  resetFcmTokenCacheForTests,
} from "./fcm";
import { decodeJwtPart } from "./jwt";
import type { FcmConfig } from "./config";

function serviceAccount(): { config: FcmConfig; publicKey: crypto.KeyObject } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    config: {
      projectId: "fsm-test",
      clientEmail: "push@fsm-test.iam.gserviceaccount.com",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      tokenUri: "https://oauth2.googleapis.com/token",
    },
    publicKey,
  };
}

afterEach(() => {
  resetFcmTokenCacheForTests();
});

describe("FCM HTTP v1", () => {
  it("signerer OAuth-assertionen med RS256 og riktige claims", () => {
    const { config, publicKey } = serviceAccount();
    const assertion = buildFcmAssertion(config, 1_700_000_000);
    const [headerPart, claimsPart, signaturePart] = assertion.split(".");
    const header = decodeJwtPart(headerPart);
    const claims = decodeJwtPart(claimsPart);

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: config.clientEmail,
      aud: config.tokenUri,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });
    expect(
      crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${headerPart}.${claimsPart}`),
        publicKey,
        Buffer.from(signaturePart, "base64url"),
      ),
    ).toBe(true);
  });

  it("bygger melding med tittel, data, sti og varsel-id", () => {
    const message = buildFcmMessage({
      token: "fcm-token-12345678",
      title: "Ny tildeling",
      body: "Et oppdrag er tildelt deg.",
      path: "/oppdrag/wo1",
      notificationId: "n1",
      type: "ASSIGNMENT",
    }) as {
      message: {
        token: string;
        notification: { title: string; body: string };
        data: Record<string, string>;
      };
    };

    expect(message.message.token).toBe("fcm-token-12345678");
    expect(message.message.notification).toEqual({
      title: "Ny tildeling",
      body: "Et oppdrag er tildelt deg.",
    });
    expect(message.message.data).toEqual({
      type: "ASSIGNMENT",
      path: "/oppdrag/wo1",
      notificationId: "n1",
    });
  });

  it("henter OAuth-token og sender melding med mock fetch", async () => {
    const { config } = serviceAccount();
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(
          JSON.stringify({ access_token: "access-1", expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ name: "projects/fsm-test/messages/42" }),
        { status: 200 },
      );
    });

    const provider = createFcmProvider(config, fetchMock);
    const result = await provider.send({
      token: "fcm-token-12345678",
      title: "Test",
      body: "Hei",
      path: "/varsler",
      notificationId: "n1",
      type: "TEST",
    });

    expect(result).toEqual({
      status: "sent",
      providerId: "projects/fsm-test/messages/42",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(sendUrl).toContain("/projects/fsm-test/messages:send");
    expect((sendInit.headers as Record<string, string>).authorization).toBe(
      "Bearer access-1",
    );
    expect(JSON.parse(String(sendInit.body))).toMatchObject({
      message: {
        token: "fcm-token-12345678",
        data: { notificationId: "n1", path: "/varsler" },
      },
    });
  });

  it("mapper UNREGISTERED til invalid_token", async () => {
    const { config } = serviceAccount();
    const fetchMock = vi.fn(
      async (url: string | URL) =>
        new Response(
          String(url).includes("oauth2.googleapis.com")
            ? JSON.stringify({ access_token: "access-1", expires_in: 3600 })
            : JSON.stringify({
                error: {
                  status: "NOT_FOUND",
                  details: [{ errorCode: "UNREGISTERED" }],
                },
              }),
          { status: String(url).includes("oauth2.googleapis.com") ? 200 : 404 },
        ),
    );

    const provider = createFcmProvider(config, fetchMock);
    await expect(
      provider.send({
        token: "fcm-token-12345678",
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
      httpStatus: 404,
    });
  });

  it("gjør ingen nettverkskall uten konfigurasjon", async () => {
    const fetchMock = vi.fn();
    const provider = createFcmProvider(null, fetchMock);
    await expect(
      provider.send({
        token: "fcm-token-12345678",
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
