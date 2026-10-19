import bcrypt from "bcrypt";
import prisma from "@/lib/prisma";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
} from "@/lib/rate-limit";

export type CredentialUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

export type CredentialResult =
  | { status: "ok"; user: CredentialUser }
  | { status: "invalid" }
  | { status: "inactive" }
  | { status: "locked"; retryAfterSeconds: number };

/** Ulike terskler for e-post og IP, så en delt kontor-IP ikke låses for fort. */
const EMAIL_FAILURE_LIMIT = 10;
const IP_FAILURE_LIMIT = 30;

function rateLimitKeys(email: string, ip?: string): string[] {
  const keys = [`email:${email.trim().toLowerCase()}`];
  if (ip) keys.push(`ip:${ip}`);
  return keys;
}

/**
 * Én felles kilde for e-post/passord-sjekken. Brukes både av NextAuth sin
 * Credentials-provider og av server-actionen på innloggingssiden, slik at
 * reglene (passord må stemme, kontoen må være aktivert) aldri kommer ut av sync.
 */
export async function verifyCredentials(
  email: string,
  password: string,
  ip?: string
): Promise<CredentialResult> {
  const keys = rateLimitKeys(email, ip);

  // Sperren sjekkes før vi slår opp brukeren, slik at gjetting ikke koster en
  // bcrypt-sammenligning per forsøk.
  const limit = checkLoginRateLimit(keys);
  if (!limit.allowed) {
    return { status: "locked", retryAfterSeconds: limit.retryAfterSeconds };
  }

  if (!email || !password) return { status: "invalid" };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) {
    recordLoginFailure(keys[0], EMAIL_FAILURE_LIMIT);
    if (ip) recordLoginFailure(keys[1], IP_FAILURE_LIMIT);
    return { status: "invalid" };
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    recordLoginFailure(keys[0], EMAIL_FAILURE_LIMIT);
    if (ip) recordLoginFailure(keys[1], IP_FAILURE_LIMIT);
    return { status: "invalid" };
  }

  // Kontoen må være manuelt aktivert av en administrator.
  if (!user.isActive) {
    recordLoginFailure(keys[0], EMAIL_FAILURE_LIMIT);
    if (ip) recordLoginFailure(keys[1], IP_FAILURE_LIMIT);
    return { status: "inactive" };
  }

  clearLoginFailures(keys);

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
