import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/credentials";
import { clientIpFrom } from "@/lib/client-ip";

/**
 * Absolutt levetid for en innlogging, uavhengig av aktivitet. NextAuth
 * fornyer `exp` hver gang sesjonen leses, så uten dette ville en aktiv økt
 * kunne leve evig. Verdien lagres i tokenet ved innlogging.
 */
export const SESSION_ABSOLUTE_MAX_AGE = 7 * 24 * 60 * 60;

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
