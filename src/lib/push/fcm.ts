import crypto from "node:crypto";
import { base64Url, jwtSigningInput } from "./jwt";
import type { FcmConfig } from "./config";
import type {
  PushDeliveryResult,
  PushProvider,
  PushSendInput,
} from "./types";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type AccessTokenCache = {
  accessToken: string;
  expiresAt: number;
};

const accessTokens = new Map<string, AccessTokenCache>();

export function resetFcmTokenCacheForTests(): void {
  accessTokens.clear();
}

function tokenCacheKey(config: FcmConfig): string {
  return `${config.projectId}:${config.clientEmail}`;
}

/**
 * Bygger RS256-assertionen FCMs OAuth-endepunkt krever. Eksportert slik at
 * signaturen kan verifiseres i tester uten å kontakte Google.
 */
export function buildFcmAssertion(
  config: FcmConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: config.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = jwtSigningInput(header, claims);
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(unsigned, "utf8"),
    config.privateKey,
  );
  return `${unsigned}.${base64Url(signature)}`;
}

/** FCM HTTP v1-meldingen. Datafelt må være strenger. */
export function buildFcmMessage(input: PushSendInput): Record<string, unknown> {
  const body = input.body ?? "";
  return {
    message: {
      token: input.token,
      notification: { title: input.title, body },
      data: {
        type: input.type,
        path: input.path ?? "",
        notificationId: input.notificationId ?? "",
      },
      android: {
        priority: "high",
        ttl: "86400s",
        notification: {
          channel_id: "fsm_notifications",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title: input.title, body },
            sound: "default",
            "content-available": 1,
          },
        },
        fcm_options: { analytics_label: "fsm_push" },
      },
    },
  };
}

async function accessToken(
  config: FcmConfig,
  fetchImpl: FetchLike,
  now = Date.now(),
): Promise<string | null> {
  const key = tokenCacheKey(config);
  const cached = accessTokens.get(key);
  if (cached && cached.expiresAt > now + 30_000) return cached.accessToken;

  const assertion = buildFcmAssertion(config, Math.floor(now / 1000));
  const response = await fetchImpl(config.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  const token =
    typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!token) return null;

  const expiresIn =
    typeof payload?.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : 3600;
  accessTokens.set(key, {
    accessToken: token,
    expiresAt: now + Math.max(60, expiresIn - 60) * 1000,
  });
  return token;
}

function errorDetails(payload: unknown): {
  errorCode: string | null;
  message: string;
} {
  if (!payload || typeof payload !== "object") {
    return { errorCode: null, message: "" };
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return { errorCode: null, message: "" };
  }
  const record = error as {
    message?: unknown;
    details?: unknown;
  };
  const details = Array.isArray(record.details) ? record.details : [];
  const detail = details.find(
    (item): item is { errorCode: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { errorCode?: unknown }).errorCode === "string",
  );
  return {
    errorCode: detail?.errorCode ?? null,
    message: typeof record.message === "string" ? record.message : "",
  };
}

function mapFcmError(status: number, payload: unknown): PushDeliveryResult {
  const { errorCode, message } = errorDetails(payload);
  if (
    status === 404 ||
    errorCode === "UNREGISTERED" ||
    errorCode === "NOT_FOUND"
  ) {
    return {
      status: "failed",
      code: "invalid_token",
      retryable: false,
      httpStatus: status,
    };
  }
  if (
    status === 429 ||
    errorCode === "QUOTA_EXCEEDED" ||
    errorCode === "UNAVAILABLE"
  ) {
    return {
      status: "failed",
      code: "rate_limited",
      retryable: true,
      httpStatus: status,
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    errorCode === "THIRD_PARTY_AUTH_ERROR"
  ) {
    return {
      status: "failed",
      code: "auth_failed",
      retryable: false,
      httpStatus: status,
    };
  }
  if (status >= 500 || status === 408) {
    return {
      status: "failed",
      code: "transient",
      retryable: true,
      httpStatus: status,
    };
  }
  if (
    errorCode === "INVALID_ARGUMENT" &&
    /token|registration/i.test(message)
  ) {
    return {
      status: "failed",
      code: "invalid_token",
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

export function createFcmProvider(
  config: FcmConfig | null,
  fetchImpl: FetchLike = fetch,
): PushProvider {
  return {
    name: "fcm",
    platform: "android",
    configured: Boolean(config),
    async send(input) {
      if (!config) return { status: "skipped", code: "not_configured" };

      let token: string | null;
      try {
        token = await accessToken(config, fetchImpl);
      } catch {
        return {
          status: "failed",
          code: "auth_failed",
          retryable: true,
        };
      }
      if (!token) {
        return { status: "failed", code: "auth_failed", retryable: true };
      }

      let response: Response;
      try {
        response = await fetchImpl(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
            config.projectId,
          )}/messages:send`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(buildFcmMessage(input)),
          },
        );
      } catch {
        return { status: "failed", code: "transient", retryable: true };
      }

      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          name?: unknown;
        } | null;
        return {
          status: "sent",
          providerId: typeof payload?.name === "string" ? payload.name : null,
        };
      }

      const payload = await response.json().catch(() => null);
      return mapFcmError(response.status, payload);
    },
  };
}
