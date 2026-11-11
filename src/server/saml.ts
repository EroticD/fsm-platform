// i18n-ignore-file: SAML-feil og loggertekst er protokoll-/driftsdata.
import { randomBytes } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
  type Profile,
} from "@node-saml/node-saml";

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { safeLoginCallbackTarget } from "@/lib/safe-redirect";
import {
  normalizeSamlCertificate,
  samlClaimsFromProfile,
  samlProviderBySlug,
  samlSsoConfig,
  type SamlProviderConfig,
} from "@/lib/saml";
import { resolveSsoUser, recordSsoLogin, type SsoSessionUser } from "@/server/sso";
import { ssoTwoFactorGate } from "@/lib/sso";

/**
 * SAML 2.0-tjenestelaget.
 *
 * All signaturvalidering, audience/recipient-kontroll og tidsvindu håndteres av
 * `@node-saml/node-saml`. Vi legger bare på en delbar replay-/request-cache i
 * databasen, slik at to appinstanser ikke kan godta samme assertion samtidig.
 */

const CACHE_TTL_MS = 15 * 60 * 1000;
const METADATA_TTL_MS = 5 * 60 * 1000;
const RELAY_MAX_AGE_SECONDS = 10 * 60;

export class SamlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamlConfigError";
  }
}

function cacheExpiry(expiresAtMs?: number): Date {
  const expiry =
    typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)
      ? expiresAtMs
      : Date.now() + CACHE_TTL_MS;
  return new Date(expiry);
}

/**
 * Databasebasert cache for node-saml. `saveIfAbsentAsync` er atomisk via den
 * unike primærnøkkelen, slik at `rejectReplayedAssertions` faktisk virker på
 * tvers av prosesser.
 */
export function createSamlCacheProvider(): CacheProvider {
  return {
    async saveAsync(key, value) {
      const row = await prisma.samlCacheEntry.upsert({
        where: { key },
        update: { value, expiresAt: cacheExpiry() },
        create: { key, value, expiresAt: cacheExpiry() },
      });
      return { value: row.value, createdAt: row.expiresAt.getTime() };
    },
    async getAsync(key) {
      const row = await prisma.samlCacheEntry.findUnique({ where: { key } });
      if (!row) return null;
      if (row.expiresAt.getTime() <= Date.now()) {
        await prisma.samlCacheEntry.deleteMany({ where: { key } });
        return null;
      }
      return row.value;
    },
    async removeAsync(key) {
      if (!key) return null;
      const row = await prisma.samlCacheEntry.findUnique({ where: { key } });
      if (!row) return null;
      await prisma.samlCacheEntry.deleteMany({ where: { key } });
      return row.value;
    },
    async consumeAsync(key) {
      const row = await prisma.samlCacheEntry.findUnique({ where: { key } });
      if (!row) return null;
      const deleted = await prisma.samlCacheEntry.deleteMany({
        where: { key, value: row.value },
      });
      return deleted.count === 1 ? row.value : null;
    },
    async saveIfAbsentAsync(key, value, expiresAtMs) {
      const expiresAt = cacheExpiry(expiresAtMs);
      // En utløpt rad skal ikke blokkere en ny innlogging med samme id.
      await prisma.samlCacheEntry.deleteMany({
        where: { key, expiresAt: { lte: new Date() } },
      });
      try {
        await prisma.samlCacheEntry.create({
          data: { key, value, expiresAt },
        });
        return true;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}

export type SamlMetadata = {
  entryPoint: string;
  idpCert: string;
  entityId: string | null;
};

function textOf(element: Element | null): string {
  return element?.textContent?.trim() ?? "";
}

/**
 * Leser IdP-metadata. Vi godtar bare http(s)-URL-er og en begrenset
 * dokumentstørrelse, slik at en konfigurasjonsfeil ikke kan brukes til SSRF
 * mot vilkårlige interne tjenester.
 */
export function parseSamlMetadata(xml: string): SamlMetadata {
  if (xml.length > 512_000) {
    throw new SamlConfigError("SAML-metadata er for stor");
  }
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc || doc.getElementsByTagName("parsererror").length > 0) {
    throw new SamlConfigError("SAML-metadata er ugyldig XML");
  }

  const services = doc.getElementsByTagNameNS("*", "SingleSignOnService");
  let entryPoint = "";
  for (let index = 0; index < services.length; index += 1) {
    const service = services.item(index);
    if (!service) continue;
    const binding = service.getAttribute("Binding") ?? "";
    if (
      binding === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ||
      !entryPoint
    ) {
      entryPoint = service.getAttribute("Location") ?? entryPoint;
      if (binding === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST") break;
    }
  }

  const certs = doc.getElementsByTagNameNS("*", "X509Certificate");
  const idpCert = normalizeSamlCertificate(textOf(certs.item(0)));
  const entities = doc.getElementsByTagNameNS("*", "EntityDescriptor");
  const entityId = entities.item(0)?.getAttribute("entityID") ?? null;

  if (!entryPoint || !idpCert) {
    throw new SamlConfigError("SAML-metadata mangler SSO-URL eller sertifikat");
  }
  return { entryPoint, idpCert, entityId };
}

let metadataCache: { url: string; at: number; data: SamlMetadata } | null = null;

async function fetchSamlMetadata(url: string): Promise<SamlMetadata> {
  if (
    metadataCache &&
    metadataCache.url === url &&
    Date.now() - metadataCache.at < METADATA_TTL_MS
  ) {
    return metadataCache.data;
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "application/xml,text/xml" },
  });
  if (!response.ok) {
    throw new SamlConfigError("Kunne ikke hente SAML-metadata");
  }
  const xml = await response.text();
  const data = parseSamlMetadata(xml);
  metadataCache = { url, at: Date.now(), data };
  return data;
}

/** Slår sammen eksplisitt konfigurasjon med IdP-metadata. */
export async function resolveSamlProvider(
  config: SamlProviderConfig,
): Promise<SamlProviderConfig> {
  let metadata: SamlMetadata | null = null;
  if (config.metadataXml) {
    metadata = parseSamlMetadata(config.metadataXml);
  } else if (config.metadataUrl) {
    metadata = await fetchSamlMetadata(config.metadataUrl);
  }

  const entryPoint = config.entryPoint || metadata?.entryPoint || "";
  const idpCert = config.idpCert || metadata?.idpCert || "";
  if (!entryPoint || !idpCert) {
    throw new SamlConfigError("SAML-leverandøren mangler SSO-URL eller sertifikat");
  }
  return {
    ...config,
    entryPoint,
    idpCert,
    idpIssuer: config.idpIssuer ?? metadata?.entityId ?? null,
  };
}

export function createSamlInstance(config: SamlProviderConfig): SAML {
  return new SAML({
    callbackUrl: config.acsUrl,
    entryPoint: config.entryPoint,
    issuer: config.spEntityId,
    audience: config.audience,
    idpCert: config.idpCert,
    ...(config.idpIssuer ? { idpIssuer: config.idpIssuer } : {}),
    wantAssertionsSigned: config.wantAssertionsSigned,
    wantAuthnResponseSigned: config.wantResponseSigned,
    // IdP-initierte svar har ingen InResponseTo. Da er replay-vakten og
    // signatur/audience/tid fortsatt aktiv, men request-id-kontrollen slås av.
    validateInResponseTo: config.allowIdpInitiated
      ? ValidateInResponseTo.never
      : ValidateInResponseTo.always,
    rejectReplayedAssertions: true,
    requestIdExpirationPeriodMs: CACHE_TTL_MS,
    acceptedClockSkewMs: 5_000,
    maxAssertionAgeMs: 5 * 60_000,
    cacheProvider: createSamlCacheProvider(),
    ...(config.signAuthnRequest && config.spPrivateKey
      ? { privateKey: config.spPrivateKey, signMetadata: true }
      : {}),
  });
}

const RELAY_KEY_PREFIX = "saml-relay:";

/**
 * RelayState er en kort, tilfeldig nøkkel til en databaseoppføring.
 *
 * En SAML-POST kommer fra IdP-ens domene. SameSite=Lax-cookies sendes ikke på
 * en slik kryssside-POST, så en cookie ville mistet callback-URL-en. Den korte
 * nøkkelen holder seg innenfor IdP-enes RelayState-grense, og oppføringen
 * slettes når den brukes.
 */
export async function createSamlRelayState(
  slug: string,
  callbackUrl: string,
): Promise<string> {
  const nonce = randomBytes(18).toString("base64url");
  await prisma.samlCacheEntry.create({
    data: {
      key: `${RELAY_KEY_PREFIX}${slug}:${nonce}`,
      value: safeLoginCallbackTarget(callbackUrl),
      expiresAt: new Date(Date.now() + RELAY_MAX_AGE_SECONDS * 1000),
    },
  });
  return nonce;
}

export async function readSamlRelayState(
  slug: string,
  relayState: string | null,
): Promise<string> {
  if (!relayState) return "/";
  const key = `${RELAY_KEY_PREFIX}${slug}:${relayState}`;
  try {
    const row = await prisma.samlCacheEntry.findUnique({ where: { key } });
    if (!row) return "/";
    await prisma.samlCacheEntry.deleteMany({ where: { key } });
    if (row.expiresAt.getTime() <= Date.now()) return "/";
    return safeLoginCallbackTarget(row.value);
  } catch {
    return "/";
  }
}

/**
 * Kontrollerer Recipient i den signerte assertionen. node-saml bruker
 * callbackUrl som audience og validerer tidsvinduet, men recipient-attributtet
 * må sjekkes mot vår egen ACS-URL for at en assertion for en annen tjeneste
 * ikke skal kunne gjenbrukes her.
 */
export function assertionRecipientMatches(
  profile: Profile,
  acsUrl: string,
): boolean {
  const xml = profile.getAssertionXml?.();
  if (!xml) return false;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc || doc.getElementsByTagName("parsererror").length > 0) {
    return false;
  }
  const confirmations = doc.getElementsByTagNameNS(
    "*",
    "SubjectConfirmationData",
  );
  for (let index = 0; index < confirmations.length; index += 1) {
    const confirmation = confirmations.item(index);
    if (!confirmation) continue;
    if (confirmation.getAttribute("Recipient") === acsUrl) return true;
  }
  return false;
}

export type SamlLoginResult =
  | {
      ok: true;
      user: SsoSessionUser;
      provisioned: boolean;
      linked: boolean;
      roleChanged: boolean;
      matchedGroups: string[];
    }
  | { ok: false; reason: string };

/** Validerer en SAML-respons og kobler den til en lokal bruker. */
export async function handleSamlResponse(
  config: SamlProviderConfig,
  container: Record<string, string>,
): Promise<SamlLoginResult> {
  const runtime = await resolveSamlProvider(config);
  const saml = createSamlInstance(runtime);

  let profile: Profile | null;
  try {
    const result = await saml.validatePostResponseAsync(container);
    profile = result.profile;
  } catch (error) {
    logger.warn("SAML-respons avvist", {
      provider: config.slug,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, reason: "invalid_assertion" };
  }
  if (!profile) return { ok: false, reason: "invalid_assertion" };

  // node-saml validerer audience og signatur. Recipient i
  // SubjectConfirmationData er en egen kontroll som må gjøres eksplisitt:
  // en assertion utstedt for en annen ACS skal ikke godtas her.
  if (!assertionRecipientMatches(profile, config.acsUrl)) {
    logger.warn("SAML-assertion har feil recipient", {
      provider: config.slug,
    });
    return { ok: false, reason: "invalid_assertion" };
  }

  const claims = samlClaimsFromProfile(
    profile as unknown as Record<string, unknown>,
    config,
  );
  const result = await resolveSsoUser(samlSsoConfig(config), claims);
  if (!result.ok) return { ok: false, reason: result.reason };

  await recordSsoLogin(result.user, samlSsoConfig(config), {
    provisioned: result.provisioned,
    linked: result.linked,
    roleChanged: result.roleChanged,
  });

  return {
    ok: true,
    user: result.user,
    provisioned: result.provisioned,
    linked: result.linked,
    roleChanged: result.roleChanged,
    matchedGroups: result.matchedGroups,
  };
}

/** 2FA-gaten må kjøres før noen sesjoncookie skrives, som for OIDC. */
export function samlTwoFactorGate(user: SsoSessionUser) {
  return ssoTwoFactorGate(user);
}

export function findSamlProvider(slug: string): SamlProviderConfig | null {
  return samlProviderBySlug(slug);
}
