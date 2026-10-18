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
  providers: [
    CredentialsProvider({
      name: "Logg inn",
      credentials: {
        email: { label: "E-post", type: "email", placeholder: "din@epost.no" },
        password: { label: "Passord", type: "password" },
      },
      async authorize(credentials) {
        const result = await verifyCredentials(
          credentials?.email ?? "",
          credentials?.password ?? ""
        );

        if (result.status === "invalid") return null;

        // Kontoen må være manuelt aktivert av en administrator.
        // Feilen fanges opp av innloggingssiden og vises som en tydelig melding.
        if (result.status === "inactive") {
          throw new Error("AccountNotActivated");
        }

        // Returner dataene som lagres i brukerens "session"
        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role, // Viktig for å skille Admin fra Montør
        };
      },
    }),
  ],
  session: {
    strategy: "jwt", // Bruker tokens for sikkerhet
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
