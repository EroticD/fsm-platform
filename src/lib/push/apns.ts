import crypto from "node:crypto";
import { base64Url, jwtSigningInput } from "./jwt";
import type { ApnsConfig } from "./config";
import type {
  PushDeliveryResult,
  PushProvider,
  PushSendInput,
} from "./types";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type JwtCache = { token: string; expiresAt: number };

const cachedJwts = new Map<string, JwtCache>();

export function resetApnsJwtCacheForTests(): void {
  cachedJwts.clear();
}

function cacheKey(config: ApnsConfig): string {
  return `${config.teamId}:${config.keyId}`;
}

/**
 * ES256-signaturen må være JOSE-format (rå r||s), ikke ASN.1/DER. Node støtter
 * det med `dsaEncoding: "ieee-p1363"`.
 */
export function buildApnsJwt(
  config: ApnsConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const claims = { iss: config.teamId, iat: nowSeconds };
  const unsigned = jwtSigningInput(header, claims);
  const signature = crypto.sign(
    "sha256",
    Buffer.from(unsigned, "utf8"),
    {
      key: config.keyP8,
      dsaEncoding: "ieee-p1363",
    },
  );
  return `${unsigned}.${base64Url(signature)}`;
}

export function apnsHost(config: ApnsConfig): string {
  return config.environment === "sandbox"
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";
}

export function buildApnsPayload(input: PushSendInput): Record<string, unknown> {
  const body = input.body ?? "";
  return {
    aps: {
      alert: { title: input.title, body },
      sound: "default",
      "content-available": 1,
    },
    type: input.type,
    ...(input.path ? { path: input.path } : {}),
    ...(input.notificationId ? { notificationId: input.notificationId } : {}),
  };
}

function jwtForRequest(
  config: ApnsConfig,
  now = Date.now(),
): string {
  const key = cacheKey(config);
  const cached = cachedJwts.get(key);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const token = buildApnsJwt(config, Math.floor(now / 1000));
  // Apple avviser tokens eldre enn én time. Forny godt før det.
  cachedJwts.set(key, { token, expiresAt: now + 50 * 60_000 });
  return token;
}

function mapApnsError(
  status: number,
  reason: string | null,
): PushDeliveryResult {
  if (
    status === 410 ||
    reason === "BadDeviceToken" ||
    reason === "Unregistered" ||
    reason === "DeviceTokenNotForTopic"
  ) {
    return {
      status: "failed",
      code: "invalid_token",
      retryable: false,
      httpStatus: status,
    };
  }
  if (status === 429 || reason === "TooManyRequests") {
    return {
      status: "failed",
      code: "rate_limited",
      retryable: true,
      httpStatus: status,
    };
  }
  if (
    status >= 500 ||
    reason === "InternalServerError" ||
    reason === "ServiceUnavailable" ||
    reason === "Shutdown"
  ) {
    return {
      status: "failed",
      code: "transient",
      retryable: true,
      httpStatus: status,
    };
  }
  if (
    status === 403 ||
    reason === "InvalidProviderToken" ||
    reason === "ExpiredProviderToken"
  ) {
    return {
      status: "failed",
      code: "auth_failed",
      retryable: reason === "ExpiredProviderToken",
      httpStatus: status,
    };
  }
  if (status === 400 || status === 413) {
    return {
      status: "failed",
      code: "invalid_payload",
      retryable: false,
      httpStatus: status,
    };
  }
  return {
    status: "failed",
    code: "permanent",
    retryable: false,
    httpStatus: status,
  };
}

export function createApnsProvider(
  config: ApnsConfig | null,
  fetchImpl: FetchLike = fetch,
): PushProvider {
  return {
    name: "apns",
    platform: "ios",
    configured: Boolean(config),
    async send(input) {
      if (!config) return { status: "skipped", code: "not_configured" };

      let jwt: string;
      try {
        jwt = jwtForRequest(config);
      } catch {
        return { status: "failed", code: "auth_failed", retryable: false };
      }
      let response: Response;
      try {
        response = await fetchImpl(
          `https://${apnsHost(config)}/3/device/${encodeURIComponent(
            input.token,
          )}`,
          {
            method: "POST",
            headers: {
              authorization: `bearer ${jwt}`,
              "apns-topic": config.bundleId,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "content-type": "application/json",
            },
            body: JSON.stringify(buildApnsPayload(input)),
          },
        );
      } catch {
        return { status: "failed", code: "transient", retryable: true };
      }

      if (response.ok) {
        return {
          status: "sent",
          providerId: response.headers.get("apns-id") ?? null,
        };
      }

      const payload = (await response.json().catch(() => null)) as {
        reason?: unknown;
      } | null;
      const reason =
        typeof payload?.reason === "string" ? payload.reason : null;
      return mapApnsError(response.status, reason);
    },
  };
}
