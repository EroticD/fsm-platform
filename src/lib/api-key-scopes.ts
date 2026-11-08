/**
 * Scopes for API-nøkler.
 *
 * En nøkkel er alltid bundet til en bruker og arver brukerens rettigheter.
 * Scopene er et ekstra tak: selv om brukeren har tilgang til alt, kan en
 * integrasjon bare få det den trenger. En nøkkel med tom liste er en eldre
 * nøkkel og får alle scopes, slik at migreringen ikke bryter integrasjoner.
 */
export const API_KEY_SCOPES = [
  "workorders:read",
  "workorders:write",
  "visits:read",
  "visits:write",
  "customers:read",
  "contracts:read",
  "contracts:write",
  "sla:read",
  "equipment:read",
  "equipment:write",
  "maintenance:read",
  "maintenance:write",
  "reports:read",
  "documents:read",
  "quotes:read",
  "quotes:write",
  "orders:read",
  "orders:write",
  "inventory:read",
  "inventory:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const SCOPE_SET = new Set<string>(API_KEY_SCOPES);

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && SCOPE_SET.has(value);
}

/** Normaliserer en liste og fjerner duplikater. Ukjente scopes avvises. */
export function normalizeApiKeyScopes(value: unknown): ApiKeyScope[] {
  if (!Array.isArray(value)) throw new Error("invalid_scopes");
  const unique: ApiKeyScope[] = [];
  for (const item of value) {
    if (!isApiKeyScope(item)) throw new Error("invalid_scopes");
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
}

/** Alle scopes, brukt som standard for nye nøkler og for eldre nøkler. */
export function allApiKeyScopes(): ApiKeyScope[] {
  return [...API_KEY_SCOPES];
}

/**
 * Hvilket scope en API-forespørsel krever. `null` betyr at endepunktet ikke
 * krever noe eget scope (for eksempel `/me`).
 */
export function requiredScopeForRequest(
  method: string,
  pathname: string,
): ApiKeyScope | null {
  const prefix = "/api/v1/";
  const index = pathname.indexOf(prefix);
  if (index === -1) return null;
  const path = pathname.slice(index + prefix.length);
  const segments = path.split("/").filter(Boolean);
  const resource = segments[0] ?? "";
  const write = method !== "GET" && method !== "HEAD";

  if (resource === "me" || resource === "openapi.json") return null;

  if (resource === "work-orders") {
    if (segments.includes("visits")) {
      return write ? "visits:write" : "visits:read";
    }
    return write ? "workorders:write" : "workorders:read";
  }
  if (resource === "visits") {
    return write ? "visits:write" : "visits:read";
  }
  if (resource === "customers") return "customers:read";
  if (resource === "contracts") {
    return write ? "contracts:write" : "contracts:read";
  }
  if (resource === "sla-policies") return "sla:read";
  if (resource === "equipment") {
    return write ? "equipment:write" : "equipment:read";
  }
  if (resource === "maintenance-plans") {
    return write ? "maintenance:write" : "maintenance:read";
  }
  if (resource === "reports") return "reports:read";
  if (resource === "documents") return "documents:read";
  if (resource === "quotes") {
    return write ? "quotes:write" : "quotes:read";
  }
  if (resource === "orders") {
    return write ? "orders:write" : "orders:read";
  }
  if (resource === "inventory") {
    // Alle mutasjoner ligger under /inventory, også reservasjoner.
    return write ? "inventory:write" : "inventory:read";
  }

  return null;
}

/** Er metoden en skriveoperasjon som en read-only-nøkkel ikke får bruke? */
export function isWriteMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

/** Gyldigheten av en nøkkels scopes. Tom liste = alle (eldre nøkkel). */
export function apiKeyAllowsScope(
  key: { scopes: readonly string[]; readOnly: boolean },
  method: string,
  pathname: string,
): boolean {
  if (key.readOnly && isWriteMethod(method)) return false;
  const required = requiredScopeForRequest(method, pathname);
  if (!required) return true;
  if (key.scopes.length === 0) return true;
  return key.scopes.includes(required);
}

/** Effektive scopes for visning. */
export function effectiveApiKeyScopes(
  scopes: readonly string[],
): readonly string[] {
  return scopes.length === 0 ? API_KEY_SCOPES : scopes;
}
