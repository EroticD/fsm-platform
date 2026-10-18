import bcrypt from "bcrypt";
import prisma from "@/lib/prisma";

export type CredentialUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

export type CredentialResult =
  | { status: "ok"; user: CredentialUser }
  | { status: "invalid" }
  | { status: "inactive" };

/**
 * Én felles kilde for e-post/passord-sjekken. Brukes både av NextAuth sin
 * Credentials-provider og av server-actionen på innloggingssiden, slik at
 * reglene (passord må stemme, kontoen må være aktivert) aldri kommer ut av sync.
 */
export async function verifyCredentials(
  email: string,
  password: string
): Promise<CredentialResult> {
  if (!email || !password) return { status: "invalid" };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) return { status: "invalid" };

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) return { status: "invalid" };

  // Kontoen må være manuelt aktivert av en administrator.
  if (!user.isActive) return { status: "inactive" };

  return {
    status: "ok",
    user: {
      id: user.id,
      email: user.email ?? "",
      name: user.name,
      role: user.role,
    },
  };
}
