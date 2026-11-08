/** Oppsett av pushleverandører. Leses ved hvert kall, slik at env-endringer i
 *  drift ikke krever en kodeendring. Hemmelighetene forlater aldri prosessen. */

export type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

export type ApnsConfig = {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  environment: "production" | "sandbox";
};

export type PushProviderStatus = {
  fcm: { configured: boolean; projectId: string | null };
  apns: {
    configured: boolean;
    bundleId: string | null;
    environment: "production" | "sandbox";
  };
};

type Env = Record<string, string | undefined>;

function env(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

function privateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function parseServiceAccount(raw: string): FcmConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectId =
      typeof parsed.project_id === "string" ? parsed.project_id.trim() : "";
    const clientEmail =
      typeof parsed.client_email === "string"
        ? parsed.client_email.trim()
        : "";
    const key =
      typeof parsed.private_key === "string"
        ? privateKey(parsed.private_key)
        : "";
    const tokenUri =
      typeof parsed.token_uri === "string" && parsed.token_uri.trim()
        ? parsed.token_uri.trim()
        : "https://oauth2.googleapis.com/token";
    if (!projectId || !clientEmail || !key) return null;
    return { projectId, clientEmail, privateKey: key, tokenUri };
  } catch {
    return null;
  }
}

/** FCM HTTP v1 med tjenestekonto-JSON. Uten gyldig JSON er leverandøren av. */
export function fcmConfig(environment: Env = process.env): FcmConfig | null {
  return parseServiceAccount(env(environment, "FCM_SERVICE_ACCOUNT_JSON"));
}

function apnsKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("BEGIN PRIVATE KEY")) return privateKey(trimmed);
  // Noen miljøer lagrer nøkkelen base64-kodet fordi .env ikke liker linjeskift.
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("BEGIN PRIVATE KEY")) return privateKey(decoded);
  } catch {
    // Faller tilbake til den rå verdien under.
  }
  return privateKey(trimmed);
}

/** APNs token-basert autentisering (p8). Alle fire verdiene må være satt. */
export function apnsConfig(environment: Env = process.env): ApnsConfig | null {
  const keyP8 = apnsKey(env(environment, "APNS_KEY_P8"));
  const keyId = env(environment, "APNS_KEY_ID");
  const teamId = env(environment, "APNS_TEAM_ID");
  const bundleId = env(environment, "APNS_BUNDLE_ID");
  if (!keyP8 || !keyId || !teamId || !bundleId) return null;

  const environmentName =
    env(environment, "APNS_ENV").toLowerCase() === "sandbox"
      ? "sandbox"
      : "production";
  return { keyP8, keyId, teamId, bundleId, environment: environmentName };
}

/** Trygg visning i innstillingene: aldri nøkler, tokens eller privatnøkler. */
export function pushProviderStatus(
  environment: Env = process.env,
): PushProviderStatus {
  const fcm = fcmConfig(environment);
  const apns = apnsConfig(environment);
  return {
    fcm: {
      configured: Boolean(fcm),
      projectId: fcm?.projectId ?? null,
    },
    apns: {
      configured: Boolean(apns),
      bundleId: apns?.bundleId ?? null,
      environment: apns?.environment ?? "production",
    },
  };
}
