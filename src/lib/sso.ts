// i18n-ignore-file: konfigurasjon og feilkoder er stabile interne verdier.
import { cleanEmail } from "@/lib/sanitize";
import { requiresTwoFactorEnrollment } from "@/lib/two-factor-policy";

/**
 * OIDC-konfigurasjon for SSO.
 *
 * Hver leverandør har en egen slug. Miljøvariablene er prefikset med
 * `SSO_<SLUG>_`, og `SSO_PROVIDERS` lister hvilke sluger som er aktive. Det gjør
 * at én installasjon kan ha flere IdP-er (for eksempel Entra for ansatte og
 * Keycloak for konsulenter) uten en egen databasekolonne per leverandør.
 *
 * Standardvalgene er bevisst restriktive: ingen auto-provisjonering, laveste
 * rolle og ingen rollestyring fra grupper før det er slått eksplisitt på.
 */

export const SSO_PROVIDER_ID_PREFIX = "sso-";
export const SSO_DEFAULT_SCOPES = ["openid", "email", "profile"];

export type SsoProviderConfig = {
  slug: string;
  /** NextAuth-providerens id, også brukt i callback-URL-en. */
  id: string;
  displayName: string;
  /** OIDC er standard. SAML-leverandører bruker de samme kontoreglene. */
  protocol?: "oidc" | "saml";
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  autoProvision: boolean;
  autoProvisionActive: boolean;
  defaultRole: string;
  defaultDepartment: string | null;
  allowedEmailDomains: string[];
  groupsClaim: string;
  groupRoleMap: Record<string, string>;
  syncRoles: boolean;
  /**
   * Valgfri avdelingsmapping fra grupper. Brukes bare når den er eksplisitt
   * satt, og kan aldri gi en ukjent avdeling: da avvises innloggingen.
   */
  departmentClaim?: string | null;
  groupDepartmentMap?: Record<string, string>;
  syncDepartment?: boolean;
};

export type SsoConfig = {
  providers: SsoProviderConfig[];
  errors: string[];
};

const PROVIDER_SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DEFAULT_GROUPS_CLAIM = "groups";

function envValue(
  env: Record<string, string | undefined>,
  slug: string,
  suffix: string,
): string | undefined {
  return env[`SSO_${slug.toUpperCase().replace(/-/g, "_")}_${suffix}`];
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\.$/, "");
}

function parseAllowedDomains(value: string | undefined): string[] {
  return Array.from(
    new Set(parseList(value).map(normalizeDomain).filter(Boolean)),
  );
}

/**
 * Godtar JSON-objekt (`{"FSM-Admins":"ADMIN"}`) eller en kommaseparert liste
 * (`FSM-Admins=ADMIN,FSM-Office=OFFICE`). Verdiene normaliseres til store
 * bokstaver fordi rollenøklene i databasen er store.
 */
export function parseGroupRoleMap(
  value: string | undefined,
): { map: Record<string, string>; error: string | null } {
  const raw = value?.trim() ?? "";
  if (!raw) return { map: {}, error: null };

  const map: Record<string, string> = {};
  const add = (group: unknown, role: unknown): string | null => {
    if (typeof group !== "string" || typeof role !== "string") return "invalid";
    const key = group.trim();
    const roleKey = role.trim().toUpperCase();
    if (!key || !roleKey) return "invalid";
    if (map[key] && map[key] !== roleKey) return "duplicate";
    map[key] = roleKey;
    return null;
  };

  if (raw.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { map, error: "ugyldig JSON i gruppemapping" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { map, error: "gruppemapping må være et JSON-objekt" };
    }
    for (const [group, role] of Object.entries(parsed)) {
      const error = add(group, role);
      if (error) return { map, error: `ugyldig gruppemapping (${error})` };
    }
    return { map, error: null };
  }

  for (const pair of raw.split(",")) {
    if (!pair.trim()) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      return { map, error: "gruppemapping må være gruppe=ROLLE" };
    }
    const error = add(pair.slice(0, separator), pair.slice(separator + 1));
    if (error) return { map, error: `ugyldig gruppemapping (${error})` };
  }
  return { map, error: null };
}

/**
 * Som `parseGroupRoleMap`, men verdiene bevares som skrevet fordi de peker på
 * avdelingsnavn (som ikke er versalfølsomme i databasen, men skal vises riktig).
 */
export function parseGroupDepartmentMap(
  value: string | undefined,
): { map: Record<string, string>; error: string | null } {
  const raw = value?.trim() ?? "";
  if (!raw) return { map: {}, error: null };

  const map: Record<string, string> = {};
  const add = (group: unknown, department: unknown): string | null => {
    if (typeof group !== "string" || typeof department !== "string") {
      return "invalid";
    }
    const key = group.trim();
    const name = department.trim();
    if (!key || !name) return "invalid";
    if (map[key] && map[key] !== name) return "duplicate";
    map[key] = name;
    return null;
  };

  if (raw.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { map, error: "ugyldig JSON i avdelingsmapping" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { map, error: "avdelingsmapping må være et JSON-objekt" };
    }
    for (const [group, department] of Object.entries(parsed)) {
      const error = add(group, department);
      if (error) return { map, error: `ugyldig avdelingsmapping (${error})` };
    }
    return { map, error: null };
  }

  for (const pair of raw.split(",")) {
    if (!pair.trim()) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      return { map, error: "avdelingsmapping må være gruppe=Avdeling" };
    }
    const error = add(pair.slice(0, separator), pair.slice(separator + 1));
    if (error) return { map, error: `ugyldig avdelingsmapping (${error})` };
  }
  return { map, error: null };
}

/** Standard discovery-URL når den ikke er satt eksplisitt. */
export function ssoDiscoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Leser og validerer SSO-konfigurasjonen. Feil returneres i stedet for å kaste,
 * slik at innloggingssiden kan fortsette med passord som break-glass og
 * driftsloggen kan vise hva som er galt uten å leke med hemmelighetene.
 */
export function readSsoConfig(
  env: Record<string, string | undefined> = process.env,
): SsoConfig {
  const slugs = parseList(env.SSO_PROVIDERS).map((slug) =>
    slug.trim().toLowerCase(),
  );
  const errors: string[] = [];
  const providers: SsoProviderConfig[] = [];
  const seen = new Set<string>();

  for (const slug of slugs) {
    if (!PROVIDER_SLUG.test(slug)) {
      errors.push(`SSO_PROVIDERS: ugyldig leverandørnavn «${slug}»`);
      continue;
    }
    if (seen.has(slug)) {
      errors.push(`SSO_PROVIDERS: «${slug}» er listet flere ganger`);
      continue;
    }
    seen.add(slug);

    const enabled = parseBoolean(envValue(env, slug, "ENABLED"), true);
    if (!enabled) continue;

    const issuer = envValue(env, slug, "ISSUER")?.trim() ?? "";
    const discoveryUrl =
      envValue(env, slug, "DISCOVERY_URL")?.trim() ||
      (issuer ? ssoDiscoveryUrl(issuer) : "");
    const clientId = envValue(env, slug, "CLIENT_ID")?.trim() ?? "";
    const clientSecret = envValue(env, slug, "CLIENT_SECRET")?.trim() ?? "";
    const displayName =
      envValue(env, slug, "DISPLAY_NAME")?.trim() || slug;
    const defaultRole =
      envValue(env, slug, "DEFAULT_ROLE")?.trim().toUpperCase() || "USER";
    const groupsClaim =
      envValue(env, slug, "GROUPS_CLAIM")?.trim() || DEFAULT_GROUPS_CLAIM;
    const scopes = Array.from(
      new Set([
        "openid",
        ...(envValue(env, slug, "SCOPES")
          ? parseList(envValue(env, slug, "SCOPES"))
          : SSO_DEFAULT_SCOPES),
      ]),
    );
    const { map: groupRoleMap, error: mapError } = parseGroupRoleMap(
      envValue(env, slug, "GROUP_ROLE_MAP"),
    );
    const { map: groupDepartmentMap, error: departmentMapError } =
      parseGroupDepartmentMap(envValue(env, slug, "GROUP_DEPARTMENT_MAP"));

    if (!issuer && !discoveryUrl) {
      errors.push(`SSO ${slug}: ISSUER eller DISCOVERY_URL mangler`);
    } else if (discoveryUrl && !isHttpUrl(discoveryUrl)) {
      errors.push(`SSO ${slug}: discovery-URL må være http(s)`);
    }
    if (!clientId) errors.push(`SSO ${slug}: CLIENT_ID mangler`);
    if (!clientSecret) errors.push(`SSO ${slug}: CLIENT_SECRET mangler`);
    if (!displayName) errors.push(`SSO ${slug}: DISPLAY_NAME er tom`);
    if (mapError) errors.push(`SSO ${slug}: ${mapError}`);
    if (departmentMapError) errors.push(`SSO ${slug}: ${departmentMapError}`);
    if (defaultRole === "CUSTOMER") {
      errors.push(`SSO ${slug}: DEFAULT_ROLE kan ikke være CUSTOMER`);
    }
    if (Object.values(groupRoleMap).includes("CUSTOMER")) {
      errors.push(`SSO ${slug}: gruppemapping kan ikke gi CUSTOMER`);
    }

    if (errors.some((error) => error.startsWith(`SSO ${slug}:`))) continue;

    providers.push({
      slug,
      id: `${SSO_PROVIDER_ID_PREFIX}${slug}`,
      displayName,
      issuer: issuer || new URL(discoveryUrl).origin,
      discoveryUrl,
      clientId,
      clientSecret,
      scopes,
      autoProvision: parseBoolean(envValue(env, slug, "AUTO_PROVISION")),
      autoProvisionActive: parseBoolean(
        envValue(env, slug, "AUTO_PROVISION_ACTIVE"),
      ),
      defaultRole,
      defaultDepartment:
        envValue(env, slug, "DEFAULT_DEPARTMENT")?.trim() || null,
      allowedEmailDomains: parseAllowedDomains(
        envValue(env, slug, "ALLOWED_EMAIL_DOMAINS"),
      ),
      groupsClaim,
      groupRoleMap,
      syncRoles: parseBoolean(envValue(env, slug, "SYNC_ROLES")),
      protocol: "oidc",
      departmentClaim:
        envValue(env, slug, "DEPARTMENT_CLAIM")?.trim() || null,
      groupDepartmentMap,
      syncDepartment: parseBoolean(envValue(env, slug, "SYNC_DEPARTMENT")),
    });
  }

  return { providers, errors };
}

/** Bare de gyldige leverandørene. Brukes av NextAuth og innloggingssiden. */
export function ssoProviderConfigs(
  env: Record<string, string | undefined> = process.env,
): SsoProviderConfig[] {
  return readSsoConfig(env).providers;
}

/** Konfigurasjonsfeil til oppstartsvalidering og drift. */
export function ssoConfigErrors(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return readSsoConfig(env).errors;
}

export function ssoProviderById(
  id: string,
  env: Record<string, string | undefined> = process.env,
): SsoProviderConfig | null {
  return (
    ssoProviderConfigs(env).find((provider) => provider.id === id) ?? null
  );
}

/** Er e-postdomenet tillatt for denne leverandøren? Tom liste = alle. */
export function ssoEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = cleanEmail(email).split("@")[1] ?? "";
  return Boolean(domain) && allowedDomains.includes(domain);
}

export type SsoClaims = Record<string, unknown>;

function claimValue(claims: SsoClaims, path: string): unknown {
  let current: unknown = claims;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** OIDC `sub` er den stabile identifikatoren. Mangler den, avvises innlogging. */
export function ssoSubject(claims: SsoClaims): string | null {
  const sub = claimValue(claims, "sub");
  return typeof sub === "string" && sub.trim() ? sub.trim() : null;
}

/**
 * E-post fra standardclaimene. `preferred_username` og `upn` brukes bare når
 * de faktisk ser ut som en e-postadresse.
 */
export function ssoEmail(claims: SsoClaims): string {
  for (const key of ["email", "preferred_username", "upn"]) {
    const value = claimValue(claims, key);
    if (typeof value !== "string") continue;
    const email = cleanEmail(value);
    if (email.includes("@")) return email;
  }
  return "";
}

export function ssoDisplayName(claims: SsoClaims): string | null {
  const value = claimValue(claims, "name");
  if (typeof value === "string" && value.trim()) return value.trim();
  const given = claimValue(claims, "given_name");
  const family = claimValue(claims, "family_name");
  const parts = [given, family].filter(
    (part): part is string => typeof part === "string" && Boolean(part.trim()),
  );
  return parts.length > 0 ? parts.join(" ").trim() : null;
}

/**
 * Er e-posten bekreftet av leverandøren?
 *
 * Standardclaimet er `email_verified`. Microsoft Entra ID bruker i stedet
 * `xms_edov` (e-postdomene eid av tenanten), så begge godtas. Fravær av begge
 * betyr «ikke bekreftet» – vi kobler aldri en konto på en uverifisert adresse.
 */
export function ssoEmailVerified(claims: SsoClaims): boolean {
  const verified = claimValue(claims, "email_verified");
  if (verified === true || verified === "true") return true;
  if (verified === false || verified === "false") return false;
  const xmsEdov = claimValue(claims, "xms_edov");
  return xmsEdov === true || xmsEdov === "true";
}

/**
 * Leser grupper/roller fra et claim. Støtter:
 *  - `["FSM-Admins", "FSM-Office"]`
 *  - `[{ display: "FSM-Admins" }, { value: "FSM-Office" }]`
 *  - `{ "FSM-Admins": true }` (Zitadel-roller)
 */
export function ssoGroups(claims: SsoClaims, claimPath: string): string[] {
  const value = claimValue(claims, claimPath);
  const result: string[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        result.push(item.trim());
      } else if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const label = record.display ?? record.value ?? record.name ?? record.id;
        if (typeof label === "string" && label.trim()) {
          result.push(label.trim());
        }
      }
    }
  } else if (value && typeof value === "object") {
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) result.push(key);
    }
  } else if (typeof value === "string" && value.trim()) {
    result.push(value.trim());
  }

  return Array.from(new Set(result));
}

export type SsoRoleMapping = {
  role: string | null;
  matchedGroups: string[];
  /** Satt når gruppene peker på flere ulike roller. Da avvises innlogging. */
  conflict: string[];
};

/**
 * Oversetter grupper til én rolle. Konflikt gir ingen rolle: en bruker som er
 * medlem av både kontor- og admin-gruppen skal ikke få høyere tilgang ved et
 * uhell. Administrator må rydde i gruppene eller mappingen.
 */
export function ssoRoleFromGroups(
  groups: readonly string[],
  map: Record<string, string>,
): SsoRoleMapping {
  const matchedGroups: string[] = [];
  const roles = new Set<string>();
  for (const group of groups) {
    const role = map[group];
    if (!role) continue;
    matchedGroups.push(group);
    roles.add(role.toUpperCase());
  }

  const distinct = Array.from(roles);
  if (distinct.length > 1) {
    return { role: null, matchedGroups, conflict: distinct };
  }
  return { role: distinct[0] ?? null, matchedGroups, conflict: [] };
}

export type SsoDepartmentMapping = {
  department: string | null;
  matchedGroups: string[];
  /** Flere grupper peker på ulike avdelinger. Da brukes ingen av dem. */
  conflict: string[];
};

/**
 * Avdeling fra et eksplisitt claim eller fra gruppemapping. Claimet vinner,
 * fordi det er et bevisst attributt fra IdP-en. En konflikt gir ingen
 * avdeling – vi velger aldri en tilfeldig av flere.
 */
export function ssoDepartmentFromClaims(
  claims: SsoClaims,
  groups: readonly string[],
  config: Pick<
    SsoProviderConfig,
    "departmentClaim" | "groupDepartmentMap"
  >,
): SsoDepartmentMapping {
  if (config.departmentClaim) {
    const value = claimValue(claims, config.departmentClaim);
    if (typeof value === "string" && value.trim()) {
      return {
        department: value.trim(),
        matchedGroups: [],
        conflict: [],
      };
    }
  }

  const map = config.groupDepartmentMap ?? {};
  const matchedGroups: string[] = [];
  const departments = new Set<string>();
  for (const group of groups) {
    const department = map[group];
    if (!department) continue;
    matchedGroups.push(group);
    departments.add(department);
  }

  const distinct = Array.from(departments);
  if (distinct.length > 1) {
    return { department: null, matchedGroups, conflict: distinct };
  }
  return { department: distinct[0] ?? null, matchedGroups, conflict: [] };
}

export type SsoTwoFactorGate = "ok" | "enroll" | "verify";

/**
 * 2FA-gaten for SSO. En bruker som allerede har 2FA må taste koden, og en
 * privilegert rolle som er pålagt 2FA må fullføre oppsettet før sesjonen
 * opprettes. SSO hopper altså aldri over policyen som gjelder for passord.
 */
export function ssoTwoFactorGate(
  user: { role?: string | null; isTwoFactorEnabled?: boolean | null },
  env: Record<string, string | undefined> = process.env,
): SsoTwoFactorGate {
  if (user.isTwoFactorEnabled) return "verify";
  if (
    requiresTwoFactorEnrollment(
      { role: user.role, isTwoFactorEnabled: user.isTwoFactorEnabled },
      env,
    )
  ) {
    return "enroll";
  }
  return "ok";
}
