import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/credentials";

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
        const forwarded = request?.headers?.["x-forwarded-for"];
        const ip = forwarded?.split(",")[0]?.trim() || request?.headers?.["x-real-ip"];

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
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.sessionVersion = token.sessionVersion as number;
      }
      return session;
    },
  },
};
