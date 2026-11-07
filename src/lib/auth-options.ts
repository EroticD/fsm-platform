// i18n-ignore-file: revisjons- og loggtekst er stabile driftsdata.
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/credentials";
import { clientIpFrom } from "@/lib/client-ip";
import { requiresTwoFactorEnrollment } from "@/lib/two-factor-policy";
import {
  readSsoConfig,
  ssoDisplayName,
  ssoEmail,
  ssoProviderById,
  ssoTwoFactorGate,
  type SsoClaims,
  type SsoProviderConfig,
} from "@/lib/sso";
import { logger } from "@/lib/logger";
import { resolveSsoUser, recordSsoLogin } from "@/server/sso";

/**
 * Absolutt levetid for en innlogging, uavhengig av aktivitet. NextAuth
 * fornyer `exp` hver gang sesjonen leses, så uten dette ville en aktiv økt
 * kunne leve evig. Verdien lagres i tokenet ved innlogging.
 */
export const SESSION_ABSOLUTE_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * NextAuth-provider for én OIDC-leverandør.
 *
 * Vi bruker discovery (`wellKnown`) i stedet for hardkodede endepunkter, slik
 * at Entra ID, Keycloak, Authentik og Zitadel alle virker uten egne
 * providerklasser. PKCE, state og nonce er påkrevd.
 */
function ssoOidcProvider(config: SsoProviderConfig) {
  return {
    id: config.id,
    name: config.displayName,
    type: "oauth" as const,
    wellKnown: config.discoveryUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { params: { scope: config.scopes.join(" ") } },
    checks: ["pkce", "state", "nonce"] as ("pkce" | "state" | "nonce")[],
    idToken: true,
    profile(profile: Record<string, unknown>) {
      return {
        id: typeof profile.sub === "string" ? profile.sub : "",
        email: ssoEmail(profile),
        name: ssoDisplayName(profile),
        image: typeof profile.picture === "string" ? profile.picture : null,
      };
    },
  };
}

/**
 * SSO-feil vises som en stabil kode på innloggingssiden. Meldingen inneholder
 * aldri e-post, claims eller tokens.
 */
const SSO_ERROR_CODES: Record<string, string> = {
  invalid_claims: "SsoInvalidClaims",
  missing_email: "SsoMissingEmail",
  unverified_email: "SsoUnverifiedEmail",
  domain_not_allowed: "SsoDomainNotAllowed",
  inactive: "SsoInactive",
  not_provisioned: "SsoNotProvisioned",
  role_conflict: "SsoRoleConflict",
  invalid_role: "SsoInvalidRole",
  invalid_department: "SsoInvalidDepartment",
  customer_account: "SsoCustomerAccount",
  identity_conflict: "SsoIdentityConflict",
  server_error: "SsoServerError",
};

function ssoErrorRedirect(reason: string): string {
  return `/logg-inn?error=${encodeURIComponent(
    SSO_ERROR_CODES[reason] ?? "SsoServerError",
  )}`;
}

/**
 * To-trinns verifisering etter SSO. Vi oppretter en kortlevd «venter på
 * 2FA»-cookie og sender brukeren til det vanlige kode- eller oppsettsteget.
 * NextAuth lager ingen sesjon når signIn returnerer en URL.
 */
async function ssoTwoFactorRedirect(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isTwoFactorEnabled: boolean;
}): Promise<string | null> {
  const gate = ssoTwoFactorGate(user);
  if (gate === "ok") return null;

  const { setPendingTwoFactor } = await import("@/lib/session-token");
  await setPendingTwoFactor(user.id);

  if (gate === "enroll") {
    try {
      const prisma = (await import("@/lib/prisma")).default;
      await prisma.auditLog.create({
        data: {
          entityType: "User",
          entityId: user.id,
          action: "2FA: påkrevd oppsett startet",
          userName: user.name || user.email || "Ukjent",
          actorId: user.id,
        },
      });
    } catch {
      // Revisjonsraden er best effort, som for passordinnlogging.
    }
    return "/logg-inn/2fa/oppsett";
  }

  return "/logg-inn/2fa";
}

const ssoConfig = readSsoConfig();
for (const error of ssoConfig.errors) {
  // Hemmeligheter logges aldri – bare hvilken innstilling som er ugyldig.
  logger.error("Ugyldig SSO-konfigurasjon", { error });
}


/**
 * NextAuth gir `request.headers` som enten et Headers-objekt eller et vanlig
 * objekt, avhengig av adapter. Den lille wrapperen gjør at vi alltid kan bruke
 * den samme, proxy-bevisste IP-hjelperen.
 */
function requestHeaders(request: { headers?: unknown } | undefined) {
  const raw = request?.headers;
  if (!raw) return null;
  return {
    get(name: string): string | null {
      const lower = name.toLowerCase();
      if (typeof (raw as Headers).get === "function") {
        return (raw as Headers).get(lower);
      }
      const record = raw as Record<string, unknown>;
      const value = record[lower] ?? record[name];
      return typeof value === "string" ? value : null;
    },
  };
}

/**
 * Felles NextAuth-konfigurasjon.
 *
 * Den ligger her og ikke i rutefilen fordi `getServerSession()` uten argumenter
 * ikke kjører callbackene våre: da mangler `session.user.role`, og
 * grensesnittet kan ikke tilpasse seg rollen (f.eks. navigasjonen). Server-
 * komponenter som trenger rollen bruker `getServerSession(authOptions)`.
 */
export const authOptions: NextAuthOptions = {
  // Bak Caddy/nginx (reverse proxy) bruker vi AUTH_TRUST_HOST=true i .env,
  // som gjør at NextAuth utleder verten fra X-Forwarded-* headere. Da peker
  // den ikke tilbake til localhost, og innlogging looper ikke.
  providers: [
    CredentialsProvider({
      name: "Logg inn",
      credentials: {
        email: { label: "E-post", type: "email", placeholder: "din@epost.no" },
        password: { label: "Passord", type: "password" },
      },
      async authorize(credentials, request) {
        const requestHeadersView = requestHeaders(request);
        const ip = requestHeadersView ? clientIpFrom(requestHeadersView) : undefined;

        const result = await verifyCredentials(
          credentials?.email ?? "",
          credentials?.password ?? "",
          ip
        );

        if (result.status === "locked") {
          throw new Error("TooManyAttempts");
        }

        if (result.status === "invalid") return null;

        // Kontoen må være manuelt aktivert av en administrator.
        // Feilen fanges opp av innloggingssiden og vises som en tydelig melding.
        if (result.status === "inactive") {
          throw new Error("AccountNotActivated");
        }

        // To-trinns verifisering må gå gjennom /logg-inn og
        // verifyTwoFactorAction. Uten dette ville en klient kunne poste
        // e-post/passord rett til /api/auth/callback/credentials og hoppe over
        // engangskoden.
        if (result.user.isTwoFactorEnabled) {
          return null;
        }

        // Påkrevd 2FA for privilegerte roller: en klient kan ikke hoppe over
        // oppsettet ved å poste passord direkte til NextAuth. En slik bruker
        // må gå gjennom /logg-inn og enrollment-gaten.
        if (requiresTwoFactorEnrollment(result.user)) {
          return null;
        }

        // Returner dataene som lagres i brukerens "session"
        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role, // Viktig for å skille Admin fra Montør
          sessionVersion: result.user.sessionVersion,
        };
      },
    }),
    // OIDC-leverandører fra miljøet. Passordinnloggingen over beholdes alltid
    // som break-glass, også når SSO er konfigurert.
    ...ssoConfig.providers.map(ssoOidcProvider),
  ],
  session: {
    strategy: "jwt", // Bruker tokens for sikkerhet
    // Kortere økt enn NextAuths standard på 30 dager: en deaktivert bruker
    // mister da tilgangen innen rimelig tid, og skrivehandlingene sjekker
    // uansett isActive mot databasen.
    maxAge: 12 * 60 * 60,
  },
  pages: {
    signIn: "/logg-inn",
    error: "/logg-inn",
  },
  events: {
    /**
     * Engangskodene for gjenoppretting skal ikke bli liggende i en cookie etter
     * utlogging. Ryddingen er best-effort: en feilet cookie-sletting skal ikke
     * hindre selve utloggingen.
     */
    async signOut({ token }) {
      // En utlogget JWT skal ikke kunne gjenbrukes hvis den er kopiert. Vi
      // øker øktversjonen, slik at alle JWTs for brukeren blir ugyldige.
      const userId =
        typeof token?.id === "string"
          ? token.id
          : typeof token?.sub === "string"
            ? token.sub
            : null;
      if (userId) {
        try {
          const { bumpSessionVersion } = await import("@/lib/session");
          await bumpSessionVersion(userId);
        } catch {
          // Utloggingen skal fullføres selv om databasen ikke svarer.
        }
      }

      try {
        const { clearRecoveryCodesForDisplay } = await import(
          "@/lib/session-token"
        );
        await clearRecoveryCodesForDisplay();
      } catch {
        // Ignorer – cookien er uansett bundet til brukeren og kortlevd.
      }
    },
  },
  callbacks: {
    /**
     * SSO-innlogging. Credentials-provideren har allerede kjørt sine egne
     * 2FA- og aktiveringskontroller i `authorize`, så den slippes rett gjennom.
     * For OIDC kobles identiteten til en lokal bruker, og 2FA sendes videre til
     * det vanlige kode-/oppsettsteget før noen sesjon opprettes.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") return true;

      const { moduleEnabled } = await import("@/server/modules");
      if (!(await moduleEnabled("sso"))) {
        return "/logg-inn?error=SsoDisabled";
      }

      const provider = ssoProviderById(account?.provider ?? "");
      if (!provider) return "/logg-inn?error=SsoConfiguration";

      const claims = (profile ?? {}) as SsoClaims;
      const result = await resolveSsoUser(provider, claims);
      if (!result.ok) {
        logger.warn("SSO-innlogging avvist", {
          provider: provider.slug,
          reason: result.reason,
        });
        return ssoErrorRedirect(result.reason);
      }

      // NextAuth bruker `user.id` som `sub` i JWT-en. Vi overskriver
      // profilobjektet med den lokale brukeren, slik at økten får vår id,
      // rolle og øktversjon – aldri IdP-ens sub eller grupper.
      const sessionUser = result.user;
      user.id = sessionUser.id;
      user.email = sessionUser.email;
      user.name = sessionUser.name;
      const mutableUser = user as typeof user & {
        role: string;
        sessionVersion: number;
      };
      mutableUser.role = sessionUser.role;
      mutableUser.sessionVersion = sessionUser.sessionVersion;

      await recordSsoLogin(sessionUser, provider, {
        provisioned: result.provisioned,
        linked: result.linked,
        roleChanged: result.roleChanged,
      });

      return (await ssoTwoFactorRedirect(sessionUser)) ?? true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.sessionVersion = user.sessionVersion;
        // Dette er det absolutte starttidspunktet. NextAuths egen `iat`
        // overskrives ved hver fornyelse, så den kan ikke brukes alene.
        token.sessionIssuedAt = Math.floor(Date.now() / 1000);
      }

      if (typeof token.sessionIssuedAt !== "number") {
        // Eldre tokens uten feltet får fristen regnet fra første gangs bruk
        // etter oppgraderingen, i stedet for å bli avvist umiddelbart.
        token.sessionIssuedAt = Math.floor(Date.now() / 1000);
      }

      const issuedAt = token.sessionIssuedAt as number;
      const age = Math.floor(Date.now() / 1000) - issuedAt;
      if (age > SESSION_ABSOLUTE_MAX_AGE) {
        // Null gjør at NextAuth avviser sesjonen og sletter cookien. Typen i
        // NextAuth 4 tillater ikke null, men runtime håndterer det.
        return null as unknown as JWT;
      }

      return token;
    },
    async session({ session, token }) {
      // Et utløpt token gir ingen bruker-id, og getCurrentUser() avviser da
      // økten. Vi unngår å kaste feil i selve sesjonskallet.
      if (!token) return session;
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.sessionVersion = token.sessionVersion as number;
      }
      return session;
    },
  },
};
