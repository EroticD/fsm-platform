/** Stabile koder delt av leverandøradapterne, utboksen og driftsmetrics. */
export const PUSH_PLATFORMS = ["android", "ios"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export type PushErrorCode =
  | "not_configured"
  | "invalid_token"
  | "rate_limited"
  | "transient"
  | "permanent"
  | "auth_failed"
  | "invalid_payload";

export type PushSendInput = {
  token: string;
  title: string;
  body: string | null;
  /** Intern appsti, f.eks. /oppdrag/<id>. Aldri en ekstern URL. */
  path: string | null;
  notificationId: string | null;
  type: string;
};

export type PushDeliveryResult =
  | { status: "sent"; providerId: string | null }
  | { status: "skipped"; code: "not_configured" }
  | {
      status: "failed";
      code: PushErrorCode;
      retryable: boolean;
      httpStatus?: number;
    };

export type PushProvider = {
  name: "fcm" | "apns";
  platform: PushPlatform;
  configured: boolean;
  send(input: PushSendInput): Promise<PushDeliveryResult>;
};

export function isPushPlatform(value: unknown): value is PushPlatform {
  return (
    typeof value === "string" &&
    (PUSH_PLATFORMS as readonly string[]).includes(value)
  );
}
