// i18n-ignore-file: HTTP-feil er driftsdata, ikke UI-tekst.
import { AccountingError } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Felles HTTP-kall for regnskapskonnektorene.
 *
 * Feilmeldingen inneholder bare status og leverandørnavn. Responskroppen
 * logges eller lagres aldri, fordi den kan inneholde kundedata.
 */
export async function accountingRequest(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AccountingError(`${provider} request failed`, "provider_error", true);
  }
  if (response.status === 429) {
    throw new AccountingError(`${provider} rate limited`, "rate_limited", true);
  }
  if (!response.ok) {
    throw new AccountingError(
      `${provider} returned HTTP ${response.status}`,
      "provider_error",
      response.status >= 500,
    );
  }
  return response;
}

export async function jsonOrNull<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Siste ledd i en Location-URL, brukt når API-et ikke returnerer kropp. */
export function idFromLocation(response: Response): string | null {
  const location = response.headers.get("location")?.trim();
  if (!location) return null;
  try {
    const url = new URL(location, "https://example.invalid");
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}
