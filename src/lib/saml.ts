// i18n-ignore-file: SAML-attributter, feilkoder og driftslogger er stabile
// protokollverdier og skal ikke oversettes.
import {
  parseGroupDepartmentMap,
  parseGroupRoleMap,
  type SsoClaims,
  type SsoProviderConfig,
} from "@/lib/sso";

/**
 * SAML 2.0-konfigurasjon for tjenesteleverandøren (SP).
 *
 * SAML er additivt: OIDC-konfigurasjonen i `SSO_*` er urørt, og hver
 * SAML-leverandør ligger i `SAML_PROVIDERS` med prefikset `SAML_<SLUG>_`.
 * Signaturen valideres alltid av `@node-saml/node-saml`; vi har ingen egen,
 * lemfeldig XML-verifisering.
 */

export const SAML_PROVIDER_ID_PREFIX = "saml-";

export type SamlProviderConfig = {
  slug: string;
  /** Stabil id for knapper og ruter. */
  id: string;
  displayName: string;
  protocol: "saml";
  /** IdP-ens SingleSignOnService (HTTP-POST eller HTTP-Redirect). */
  entryPoint: string;
  /**
   * IdP-ens metadata. Når den er satt, hentes entryPoint og sertifikat derfra
   * ved innloggingsstart og caches i kortlevd minne.
   */
  metadataUrl: string | null;
  /** Inline metadata-XML, nyttig i test og på isolerte installasjoner. */
  metadataXml: string | null;
  /** IdP-signeringssertifikat i PEM. */
  idpCert: string;
  /** Forventet issuer i assertionen. Tom = ikke valider issuer. */
  idpIssuer: string | null;
  /** SP-ens entity id. */
  spEntityId: string;
  /** AssertionConsumerService-URL. */
  acsUrl: string;
  audience: string;
  wantAssertionsSigned: boolean;
  wantResponseSigned: boolean;
  signAuthnRequest: boolean;
  /** SP-privatnøkkel når AuthnRequest skal signeres. Aldri logget. */
  spPrivateKey: string | null;
  /** IdP-initierte innlogginger har ingen InResponseTo å validere. */
  allowIdpInitiated: boolean;
  emailAttribute: string;
  nameAttribute: string | null;
  groupsAttribute: string;
  departmentAttribute: string | null;
  groupRoleMap: Record<string, string>;
  groupDepartmentMap: Record<string, string>;
  defaultRole: string;
  defaultDepartment: string | null;
  allowedEmailDomains: string[];
  autoProvision: boolean;
  autoProvisionActive: boolean;
  syncRoles: boolean;
  syncDepartment: boolean;
};

export type SamlConfig = {
  providers: SamlProviderConfig[];
  errors: string[];
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DEFAULT_EMAIL_ATTRIBUTE = "email";
const DEFAULT_GROUPS_ATTRIBUTE = "groups";

function envValue(
  env: Record<string, string | undefined>,
  slug: string,
  suffix: string,
): string | undefined {
  return env[`SAML_${slug.toUpperCase().replace(/-/g, "_")}_${suffix}`];
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Gjør et base64-sertifikat om til PEM uten å kreve at operatøren limer inn headere. */
export function normalizeSamlCertificate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("BEGIN CERTIFICATE")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

function defaultUrls(slug: string, env: Record<string, string | undefined>) {
  const base = (
    env.APP_URL ||
    env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
  const path = `/api/auth/saml/${slug}`;
  return {
    spEntityId: `${base}${path}/metadata`,
    acsUrl: `${base}${path}/acs`,
  };
}

/**
 * Leser SAML-konfigurasjonen. Ugyldige leverandører rapporteres i `errors` og
 * utelates, slik at en skrivefeil ikke tar ned hele innloggingssiden.
 */
export function readSamlConfig(
  env: Record<string, string | undefined> = process.env,
): SamlConfig {
  const slugs = parseList(env.SAML_PROVIDERS).map((slug) =>
    slug.trim().toLowerCase(),
  );
  const errors: string[] = [];
  const providers: SamlProviderConfig[] = [];
  const seen = new Set<string>();

  for (const slug of slugs) {
    if (!SLUG.test(slug)) {
      errors.push(`SAML_PROVIDERS: ugyldig leverandørnavn «${slug}»`);
      continue;
    }
    if (seen.has(slug)) {
      errors.push(`SAML_PROVIDERS: «${slug}» er listet flere ganger`);
      continue;
    }
    seen.add(slug);

    if (!parseBoolean(envValue(env, slug, "ENABLED"), true)) continue;

    const urls = defaultUrls(slug, env);
    const entryPoint =
      envValue(env, slug, "ENTRY_POINT")?.trim() ||
      envValue(env, slug, "SSO_URL")?.trim() ||
      "";
    const metadataUrl =
      envValue(env, slug, "METADATA_URL")?.trim() || null;
    const metadataXml =
      envValue(env, slug, "METADATA_XML")?.trim() || null;
    const idpCert = normalizeSamlCertificate(
      envValue(env, slug, "IDP_CERT") ??
        envValue(env, slug, "CERT") ??
        "",
    );
    const spEntityId =
      envValue(env, slug, "SP_ENTITY_ID")?.trim() || urls.spEntityId;
    const acsUrl = envValue(env, slug, "ACS_URL")?.trim() || urls.acsUrl;
    const displayName =
      envValue(env, slug, "DISPLAY_NAME")?.trim() || slug;
    const defaultRole =
      envValue(env, slug, "DEFAULT_ROLE")?.trim().toUpperCase() || "USER";
    const { map: groupRoleMap, error: roleMapError } = parseGroupRoleMap(
      envValue(env, slug, "GROUP_ROLE_MAP"),
    );
    const { map: groupDepartmentMap, error: departmentMapError } =
      parseGroupDepartmentMap(envValue(env, slug, "GROUP_DEPARTMENT_MAP"));
    const allowedEmailDomains = parseList(
      envValue(env, slug, "ALLOWED_EMAIL_DOMAINS"),
    )
      .map((domain) => domain.toLowerCase().replace(/^@/, ""))
      .filter(Boolean);

    if (!entryPoint && !metadataUrl && !metadataXml) {
      errors.push(
        `SAML ${slug}: ENTRY_POINT, METADATA_URL eller METADATA_XML mangler`,
      );
    } else if (entryPoint && !isHttpUrl(entryPoint)) {
      errors.push(`SAML ${slug}: ENTRY_POINT må være http(s)`);
    } else if (metadataUrl && !isHttpUrl(metadataUrl)) {
      errors.push(`SAML ${slug}: METADATA_URL må være http(s)`);
    }
    if (!idpCert && !metadataUrl && !metadataXml) {
      errors.push(`SAML ${slug}: IDP_CERT mangler`);
    }
    if (!isHttpUrl(acsUrl)) {
      errors.push(`SAML ${slug}: ACS_URL må være http(s)`);
    }
    if (!isHttpUrl(spEntityId)) {
      errors.push(`SAML ${slug}: SP_ENTITY_ID må være en absolutt URL`);
    }
    if (!displayName) errors.push(`SAML ${slug}: DISPLAY_NAME er tom`);
    if (defaultRole === "CUSTOMER") {
      errors.push(`SAML ${slug}: DEFAULT_ROLE kan ikke være CUSTOMER`);
    }
    if (Object.values(groupRoleMap).includes("CUSTOMER")) {
      errors.push(`SAML ${slug}: gruppemapping kan ikke gi CUSTOMER`);
    }
    if (roleMapError) errors.push(`SAML ${slug}: ${roleMapError}`);
    if (departmentMapError) {
      errors.push(`SAML ${slug}: ${departmentMapError}`);
    }
    if (
      parseBoolean(envValue(env, slug, "SIGN_AUTHN_REQUEST")) &&
      !envValue(env, slug, "SP_PRIVATE_KEY")?.trim()
    ) {
      errors.push(
        `SAML ${slug}: SIGN_AUTHN_REQUEST krever SP_PRIVATE_KEY`,
      );
    }

    if (errors.some((error) => error.startsWith(`SAML ${slug}:`))) continue;

    providers.push({
      slug,
      id: `${SAML_PROVIDER_ID_PREFIX}${slug}`,
      displayName,
      protocol: "saml",
      entryPoint,
      metadataUrl,
      metadataXml,
      idpCert,
      idpIssuer: envValue(env, slug, "IDP_ISSUER")?.trim() || null,
      spEntityId,
      acsUrl,
      audience: envValue(env, slug, "AUDIENCE")?.trim() || spEntityId,
      // En SAML-respons uten signert assertion er ikke en autentisering.
      wantAssertionsSigned: parseBoolean(
        envValue(env, slug, "WANT_ASSERTIONS_SIGNED"),
        true,
      ),
      wantResponseSigned: parseBoolean(
        envValue(env, slug, "WANT_RESPONSE_SIGNED"),
        false,
      ),
      signAuthnRequest: parseBoolean(
        envValue(env, slug, "SIGN_AUTHN_REQUEST"),
        false,
      ),
      spPrivateKey:
        envValue(env, slug, "SP_PRIVATE_KEY")?.replace(/\\n/g, "\n").trim() ||
        null,
      allowIdpInitiated: parseBoolean(
        envValue(env, slug, "ALLOW_IDP_INITIATED"),
        false,
      ),
      emailAttribute:
        envValue(env, slug, "EMAIL_ATTRIBUTE")?.trim() ||
        DEFAULT_EMAIL_ATTRIBUTE,
      nameAttribute:
        envValue(env, slug, "NAME_ATTRIBUTE")?.trim() || null,
      groupsAttribute:
        envValue(env, slug, "GROUPS_ATTRIBUTE")?.trim() ||
        DEFAULT_GROUPS_ATTRIBUTE,
      departmentAttribute:
        envValue(env, slug, "DEPARTMENT_ATTRIBUTE")?.trim() || null,
      groupRoleMap,
      groupDepartmentMap,
      defaultRole,
      defaultDepartment:
        envValue(env, slug, "DEFAULT_DEPARTMENT")?.trim() || null,
      allowedEmailDomains,
      autoProvision: parseBoolean(envValue(env, slug, "AUTO_PROVISION")),
      autoProvisionActive: parseBoolean(
        envValue(env, slug, "AUTO_PROVISION_ACTIVE"),
      ),
      syncRoles: parseBoolean(envValue(env, slug, "SYNC_ROLES")),
      syncDepartment: parseBoolean(envValue(env, slug, "SYNC_DEPARTMENT")),
    });
  }

  return { providers, errors };
}

export function samlProviderConfigs(
  env: Record<string, string | undefined> = process.env,
): SamlProviderConfig[] {
  return readSamlConfig(env).providers;
}

export function samlConfigErrors(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return readSamlConfig(env).errors;
}

export function samlProviderBySlug(
  slug: string,
  env: Record<string, string | undefined> = process.env,
): SamlProviderConfig | null {
  return (
    samlProviderConfigs(env).find((provider) => provider.slug === slug) ?? null
  );
}

/**
 * SAML-leverandøren bruker nøyaktig samme kontokobling som OIDC. Vi oversetter
 * til det felles formatet i stedet for å duplisere provisjoneringsreglene.
 */
export function samlSsoConfig(config: SamlProviderConfig): SsoProviderConfig {
  return {
    slug: config.slug,
    id: config.id,
    displayName: config.displayName,
    protocol: "saml",
    issuer: config.idpIssuer || config.entryPoint,
    discoveryUrl: "",
    clientId: "",
    clientSecret: "",
    scopes: [],
    autoProvision: config.autoProvision,
    autoProvisionActive: config.autoProvisionActive,
    defaultRole: config.defaultRole,
    defaultDepartment: config.defaultDepartment,
    allowedEmailDomains: config.allowedEmailDomains,
    // Attributtnavnet kan være en URI med punktum; den felles claimleseren
    // bruker derfor den normaliserte nøkkelen «groups».
    groupsClaim: "groups",
    groupRoleMap: config.groupRoleMap,
    syncRoles: config.syncRoles,
    // SAML-attributtnavn kan være URN-er med punktum; claimet normaliseres
    // derfor til «department» før den felles avdelingslogikken leser det.
    departmentClaim: config.departmentAttribute ? "department" : null,
    groupDepartmentMap: config.groupDepartmentMap,
    syncDepartment: config.syncDepartment,
  };
}

function attributeString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = attributeString(item);
      if (text) return text;
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "text", "_", "#text"]) {
      const text = attributeString(record[key]);
      if (text) return text;
    }
  }
  return null;
}

function attributeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => attributeString(item))
          .filter((item): item is string => Boolean(item)),
      ),
    );
  }
  const single = attributeString(value);
  return single ? [single] : [];
}

/**
 * Oversetter en signert SAML-profil til de samme claimene OIDC bruker.
 *
 * `email_verified` settes fordi hele assertionen er signert av den tillitsfulle
 * IdP-en. Uten en e-postadresse avvises innloggingen av fellestjenesten.
 */
export function samlClaimsFromProfile(
  profile: Record<string, unknown>,
  config: SamlProviderConfig,
): SsoClaims {
  const nameID = attributeString(profile.nameID);
  const email =
    attributeString(profile[config.emailAttribute]) ||
    attributeString(profile.mail) ||
    attributeString(profile.email) ||
    attributeString(
      profile[
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
      ],
    ) ||
    "";
  const name =
    (config.nameAttribute
      ? attributeString(profile[config.nameAttribute])
      : null) ||
    attributeString(profile.displayName) ||
    attributeString(profile.cn) ||
    [
      attributeString(profile.givenName),
      attributeString(profile.sn),
    ]
      .filter(Boolean)
      .join(" ") ||
    null;
  const groups = attributeList(profile[config.groupsAttribute]);
  const department =
    (config.departmentAttribute
      ? attributeString(profile[config.departmentAttribute])
      : null) || null;

  return {
    sub: nameID || attributeString(profile.uid) || "",
    email,
    email_verified: Boolean(email),
    name,
    ...(config.groupsAttribute === "groups"
      ? {}
      : { [config.groupsAttribute]: groups }),
    groups,
    ...(department && config.departmentAttribute
      ? { [config.departmentAttribute]: department, department }
      : {}),
  };
}
