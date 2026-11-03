import crypto from "node:crypto";

/**
 * SMS-leverandører uten leverandør-SDK.
 *
 * Alt går over `fetch` og HMAC. `SMS_PROVIDER` velger adapter, og standarden
 * er `console`: en tørrkjøring som aldri sender noe ut av prosessen. Det gjør
 * det trygt å utvikle og teste flyten før en avtale med en leverandør er på
 * plass. Se `docs/DECISIONS.md` (D-2).
 */

export const SMS_PROVIDERS = [
  "console",
  "linkmobility",
  "pswincom",
  "twilio",
] as const;

export type SmsProviderName = (typeof SMS_PROVIDERS)[number];

export type SmsSendInput = {
  to: string;
  body: string;
  senderId?: string | null;
  reference?: string | null;
};

export type SmsSendResult = {
  provider: SmsProviderName;
  providerId: string;
  dryRun: boolean;
};

export type SmsInboundMessage = {
  provider: SmsProviderName;
  providerId: string;
  from: string;
  to: string;
  body: string;
  receivedAt: Date | null;
};

/** Leveringsstatus fra leverandørens status-callback. */
export type SmsStatusUpdate = {
  provider: SmsProviderName;
  providerId: string;
  status: "SENT" | "DELIVERED" | "FAILED";
  occurredAt: Date | null;
  error: string | null;
};

export type SmsWebhookRequest = {
  rawBody: string;
  headers: Headers;
  url?: string;
};

export type SmsProvider = {
  name: SmsProviderName;
  send(input: SmsSendInput): Promise<SmsSendResult>;
  parseWebhook(request: SmsWebhookRequest): SmsInboundMessage | null;
  /** Status-/leveringscallback. null betyr «ikke en statusmelding». */
  parseStatus(request: SmsWebhookRequest): SmsStatusUpdate | null;
  verifySignature(request: SmsWebhookRequest): boolean;
};

export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "provider_error"
      | "invalid_signature"
      | "invalid_payload",
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function resolveSmsProviderName(
  value: string | undefined = process.env.SMS_PROVIDER,
): SmsProviderName {
  const candidate = (value ?? "").trim().toLowerCase();
  return (SMS_PROVIDERS as readonly string[]).includes(candidate)
    ? (candidate as SmsProviderName)
    : "console";
}

export function smsSenderId(): string {
  return env("SMS_SENDER_ID") || "FSM";
}

export function smsDryRun(): boolean {
  return resolveSmsProviderName() === "console";
}

export type SmsProviderInfo = {
  provider: SmsProviderName;
  senderId: string;
  dryRun: boolean;
  signatureConfigured: boolean;
};

/** Trygg visning av leverandøroppsettet i innstillingene. */
export function smsProviderInfo(): SmsProviderInfo {
  const provider = resolveSmsProviderName();
  return {
    provider,
    senderId: smsSenderId(),
    dryRun: provider === "console",
    signatureConfigured: Boolean(smsWebhookSecret(provider)),
  };
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Konstant-tid sammenligning uten å lekke lengden på hemmeligheten. */
export function safeCompareStrings(a: string, b: string): boolean {
  const left = crypto.createHash("sha256").update(a, "utf8").digest();
  const right = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(left, right);
}

function header(request: SmsWebhookRequest, name: string): string {
  return request.headers.get(name)?.trim() ?? "";
}

function firstHeader(request: SmsWebhookRequest, names: string[]): string {
  for (const name of names) {
    const value = header(request, name);
    if (value) return value;
  }
  return "";
}

function stripSignaturePrefix(value: string): string {
  return value.replace(/^sha256=/i, "").trim();
}

function timestampFresh(timestamp: string): boolean {
  if (!timestamp) return true;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  return Math.abs(Date.now() / 1000 - seconds) <= SIGNATURE_TOLERANCE_SECONDS;
}

export function smsWebhookSecret(provider: SmsProviderName): string {
  switch (provider) {
    case "linkmobility":
      return env("SMS_LINKMOBILITY_SECRET") || env("SMS_WEBHOOK_SECRET");
    case "pswincom":
      return env("SMS_PSWINCOM_SECRET") || env("SMS_WEBHOOK_SECRET");
    case "twilio":
      return env("SMS_TWILIO_AUTH_TOKEN") || env("SMS_WEBHOOK_SECRET");
    default:
      return env("SMS_WEBHOOK_SECRET");
  }
}

function signatureHeaderNames(provider: SmsProviderName): string[] {
  switch (provider) {
    case "linkmobility":
      return ["x-lm-signature", "x-sms-signature"];
    case "pswincom":
      return ["x-pswincom-signature", "x-sms-signature"];
    case "twilio":
      return ["x-twilio-signature"];
    default:
      return ["x-sms-signature"];
  }
}

function hmacSignatureValid(
  provider: SmsProviderName,
  request: SmsWebhookRequest,
): boolean {
  const secret = smsWebhookSecret(provider);
  if (!secret) {
    // Konsoll-leverandøren er en utviklings-/tørrkjøringsmodus. Uten
    // hemmelighet godtas den bare utenfor produksjon.
    return provider === "console" && process.env.NODE_ENV !== "production";
  }

  const signature = stripSignaturePrefix(
    firstHeader(request, signatureHeaderNames(provider)),
  );
  if (!signature) return false;

  const timestamp = firstHeader(request, [
    "x-sms-timestamp",
    "x-lm-timestamp",
    "x-pswincom-timestamp",
  ]);
  if (!timestampFresh(timestamp)) return false;

  const payload = timestamp
    ? `${timestamp}.${request.rawBody}`
    : request.rawBody;
  return safeCompareStrings(hmacSha256Hex(secret, payload), signature);
}

function twilioSignatureValid(request: SmsWebhookRequest): boolean {
  const secret = smsWebhookSecret("twilio");
  if (!secret) return false;

  const signature = header(request, "x-twilio-signature");
  if (!signature || !request.url) return false;

  const params = new URLSearchParams(request.rawBody);
  const data = [...params.keys()]
    .sort()
    .reduce((acc, key) => acc + key + (params.get(key) ?? ""), request.url);
  const expected = crypto
    .createHmac("sha1", secret)
    .update(data, "utf8")
    .digest("base64");
  return safeCompareStrings(expected, signature);
}

export function verifySmsSignature(
  provider: SmsProviderName,
  request: SmsWebhookRequest,
): boolean {
  try {
    return provider === "twilio"
      ? twilioSignatureValid(request)
      : hmacSignatureValid(provider, request);
  } catch {
    return false;
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function readJson(rawBody: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

function text(value: unknown, max = 1600): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, max);
}

function firstText(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function xmlText(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!match) return "";
  return text(
    match[1]
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function inboundFromRecord(
  provider: SmsProviderName,
  record: JsonRecord,
): SmsInboundMessage | null {
  const providerId = firstText(record, ["id", "messageId", "providerId", "smsId"]);
  const from = firstText(record, ["from", "sender", "msisdn", "source"]);
  const to = firstText(record, [
    "to",
    "receiver",
    "destination",
    "recipient",
  ]);
  const body = firstText(record, ["body", "message", "text", "msg"]);
  if (!providerId || !from || !to || !body) return null;

  const received = firstText(record, ["receivedAt", "timestamp", "time"]);
  const parsed = received ? new Date(received) : null;
  return {
    provider,
    providerId: providerId.slice(0, 200),
    from,
    to,
    body: body.slice(0, 1600),
    receivedAt:
      parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
  };
}

/**
 * Oversetter leverandørenes mange statusnavn til de fire tilstandene vi
 * lagrer. Ukjente og mellomliggende statuser (queued/pending) ignoreres, slik
 * at en callback aldri nedgraderer en levert melding.
 */
export function normalizeSmsStatus(
  value: unknown,
): "SENT" | "DELIVERED" | "FAILED" | null {
  const status = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!status) return null;
  if (
    [
      "delivered",
      "delivery_success",
      "delivered_to_handset",
      "delivrd",
      "read",
      "completed",
    ].includes(status)
  ) {
    return "DELIVERED";
  }
  if (
    ["sent", "accepted", "sent_to_network", "submitted", "ok"].includes(status)
  ) {
    return "SENT";
  }
  if (
    [
      "failed",
      "undelivered",
      "rejected",
      "expired",
      "error",
      "failed_to_send",
      "undeliv",
      "not_delivered",
    ].includes(status)
  ) {
    return "FAILED";
  }
  return null;
}

function statusFromRecord(
  provider: SmsProviderName,
  record: JsonRecord,
): SmsStatusUpdate | null {
  const providerId = firstText(record, [
    "id",
    "messageId",
    "providerId",
    "smsId",
    "MessageSid",
    "SmsSid",
  ]);
  const status = normalizeSmsStatus(
    firstText(record, [
      "status",
      "state",
      "event",
      "messageStatus",
      "deliveryStatus",
      "MessageStatus",
      "SmsStatus",
    ]),
  );
  if (!providerId || !status) return null;

  const occurred = firstText(record, [
    "occurredAt",
    "timestamp",
    "time",
    "deliveredAt",
  ]);
  const parsed = occurred ? new Date(occurred) : null;
  const error = firstText(record, [
    "error",
    "errorCode",
    "reason",
    "description",
    "ErrorCode",
  ]);

  return {
    provider,
    providerId: providerId.slice(0, 200),
    status,
    occurredAt:
      parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    error: error ? error.slice(0, 200) : null,
  };
}

function consoleProvider(): SmsProvider {
  return {
    name: "console",
    async send() {
      // Ingen nettverkskall. Id-en er unik per sending, slik at køen og
      // idempotensen oppfører seg som hos en ekte leverandør.
      return {
        provider: "console",
        providerId: `console-${crypto.randomUUID()}`,
        dryRun: true,
      };
    },
    parseWebhook(request) {
      const record = readJson(request.rawBody);
      return record ? inboundFromRecord("console", record) : null;
    },
    parseStatus(request) {
      const record = readJson(request.rawBody);
      return record ? statusFromRecord("console", record) : null;
    },
    verifySignature(request) {
      return verifySmsSignature("console", request);
    },
  };
}

async function postWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const timeout = Number(env("SMS_TIMEOUT_MS")) || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requireUrl(name: string): string {
  const value = env(name);
  if (!value) {
    throw new SmsProviderError(
      `SMS provider URL is not configured (${name})`,
      "not_configured",
    );
  }
  return value;
}

function linkMobilityProvider(): SmsProvider {
  return {
    name: "linkmobility",
    async send(input) {
      const url = requireUrl("SMS_LINKMOBILITY_URL");
      const secret = env("SMS_LINKMOBILITY_API_KEY");
      const response = await postWithTimeout(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({
          sender: input.senderId || smsSenderId(),
          recipient: input.to,
          message: input.body,
          reference: input.reference ?? undefined,
        }),
      });
      if (!response.ok) {
        throw new SmsProviderError(
          `Link Mobility responded with ${response.status}`,
          "provider_error",
        );
      }
      const payload = asRecord(await response.json().catch(() => null));
      return {
        provider: "linkmobility",
        providerId:
          (payload && firstText(payload, ["id", "messageId"])) ||
          `lm-${crypto.randomUUID()}`,
        dryRun: false,
      };
    },
    parseWebhook(request) {
      const record = readJson(request.rawBody);
      return record ? inboundFromRecord("linkmobility", record) : null;
    },
    parseStatus(request) {
      const record = readJson(request.rawBody);
      return record ? statusFromRecord("linkmobility", record) : null;
    },
    verifySignature(request) {
      return verifySmsSignature("linkmobility", request);
    },
  };
}

function pswincomProvider(): SmsProvider {
  return {
    name: "pswincom",
    async send(input) {
      const url = requireUrl("SMS_PSWINCOM_URL");
      const body = new URLSearchParams({
        user: env("SMS_PSWINCOM_USER"),
        pw: env("SMS_PSWINCOM_PASSWORD"),
        sender: input.senderId || smsSenderId(),
        receiver: input.to,
        msg: input.body,
      });
      if (input.reference) body.set("id", input.reference);

      const response = await postWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) {
        throw new SmsProviderError(
          `PSWinCom responded with ${response.status}`,
          "provider_error",
        );
      }
      const responseBody = await response.text();
      return {
        provider: "pswincom",
        providerId:
          xmlText(responseBody, "ID") ||
          text(responseBody, 200) ||
          `psw-${crypto.randomUUID()}`,
        dryRun: false,
      };
    },
    parseWebhook(request) {
      const record = readJson(request.rawBody);
      if (record) return inboundFromRecord("pswincom", record);
      const xml = request.rawBody;
      const providerId = xmlText(xml, "ID") || xmlText(xml, "MessageId");
      const from = xmlText(xml, "SENDER") || xmlText(xml, "Sender");
      const to = xmlText(xml, "RECEIVER") || xmlText(xml, "Receiver");
      const body = xmlText(xml, "MSG") || xmlText(xml, "Message");
      if (!providerId || !from || !to || !body) return null;
      return {
        provider: "pswincom",
        providerId: providerId.slice(0, 200),
        from,
        to,
        body: body.slice(0, 1600),
        receivedAt: null,
      };
    },
    parseStatus(request) {
      const record = readJson(request.rawBody);
      if (record) return statusFromRecord("pswincom", record);
      const xml = request.rawBody;
      const providerId = xmlText(xml, "ID") || xmlText(xml, "MessageId");
      const status = normalizeSmsStatus(
        xmlText(xml, "STATUS") ||
          xmlText(xml, "Status") ||
          xmlText(xml, "DELIVERYSTATUS") ||
          xmlText(xml, "State"),
      );
      if (!providerId || !status) return null;
      const error =
        xmlText(xml, "ERROR") ||
        xmlText(xml, "Error") ||
        xmlText(xml, "REASON");
      return {
        provider: "pswincom",
        providerId: providerId.slice(0, 200),
        status,
        occurredAt: null,
        error: error ? error.slice(0, 200) : null,
      };
    },
    verifySignature(request) {
      return verifySmsSignature("pswincom", request);
    },
  };
}

function twilioProvider(): SmsProvider {
  return {
    name: "twilio",
    async send(input) {
      const sid = env("SMS_TWILIO_ACCOUNT_SID");
      const token = env("SMS_TWILIO_AUTH_TOKEN");
      if (!sid || !token) {
        throw new SmsProviderError(
          "Twilio credentials are not configured",
          "not_configured",
        );
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        sid,
      )}/Messages.json`;
      const body = new URLSearchParams({
        To: input.to,
        From: input.senderId || smsSenderId(),
        Body: input.body,
      });
      const response = await postWithTimeout(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        body: body.toString(),
      });
      if (!response.ok) {
        throw new SmsProviderError(
          `Twilio responded with ${response.status}`,
          "provider_error",
        );
      }
      const payload = asRecord(await response.json().catch(() => null));
      return {
        provider: "twilio",
        providerId:
          (payload && firstText(payload, ["sid"])) ||
          `twilio-${crypto.randomUUID()}`,
        dryRun: false,
      };
    },
    parseWebhook(request) {
      const params = new URLSearchParams(request.rawBody);
      const record: JsonRecord = {
        id: params.get("MessageSid") ?? params.get("SmsSid"),
        from: params.get("From"),
        to: params.get("To"),
        body: params.get("Body"),
      };
      return inboundFromRecord("twilio", record);
    },
    parseStatus(request) {
      const params = new URLSearchParams(request.rawBody);
      const record: JsonRecord = {
        MessageSid: params.get("MessageSid") ?? params.get("SmsSid"),
        MessageStatus: params.get("MessageStatus") ?? params.get("SmsStatus"),
        ErrorCode: params.get("ErrorCode"),
      };
      return statusFromRecord("twilio", record);
    },
    verifySignature(request) {
      return verifySmsSignature("twilio", request);
    },
  };
}

export function getSmsProvider(
  name: SmsProviderName = resolveSmsProviderName(),
): SmsProvider {
  switch (name) {
    case "linkmobility":
      return linkMobilityProvider();
    case "pswincom":
      return pswincomProvider();
    case "twilio":
      return twilioProvider();
    default:
      return consoleProvider();
  }
}
