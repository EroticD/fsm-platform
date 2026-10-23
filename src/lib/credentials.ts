import bcrypt from "bcrypt";
import prisma from "@/lib/prisma";
import { allowRequestDb, resetRateLimitDb } from "@/lib/rate-limit-db";

export type CredentialUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isTwoFactorEnabled: boolean;
  sessionVersion: number;
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

  // Sperren ligger i databasen, slik at den gjelder på tvers av instanser.
  // Den sjekkes før brukeroppslaget, så gjetting ikke koster en bcrypt-runde.
  const emailLimit = await allowRequestDb(keys[0], EMAIL_FAILURE_LIMIT, 15 * 60_000);
  const ipLimit = ip
    ? await allowRequestDb(keys[1], IP_FAILURE_LIMIT, 15 * 60_000)
    : { allowed: true, retryAfterSeconds: 0 };
  if (!emailLimit.allowed || !ipLimit.allowed) {
    return {
      status: "locked",
      retryAfterSeconds: Math.max(
        emailLimit.retryAfterSeconds,
        ipLimit.retryAfterSeconds,
      ),
    };
  }

  if (!email || !password) return { status: "invalid" };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) return { status: "invalid" };

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) return { status: "invalid" };

  // Kontoen må være manuelt aktivert av en administrator.
  if (!user.isActive) return { status: "inactive" };

  await resetRateLimitDb(...keys);

  return {
    status: "ok",
    user: {
      id: user.id,
      email: user.email ?? "",
      name: user.name,
      role: user.role,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      sessionVersion: user.sessionVersion,
    },
  };
}
