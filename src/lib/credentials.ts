import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { allowRequestDb, resetRateLimitDb } from "@/lib/rate-limit-db";
import { cleanEmail } from "@/lib/sanitize";

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
const FAILURE_WINDOW_MS = 15 * 60_000;

/**
 * Et gyldig bcrypt-hash som aldri matcher et reelt passord. Ukjente e-poster
 * sammenlignes mot dette, slik at oppslaget koster omtrent like mye uansett om
 * kontoen finnes.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$10$5xCJo0iJ8CuF52QXpORbiekx7feArvElIM.SJUBu5QAE4sDFmfZZm";

const accountKey = (email: string) => `email:${email}`;
const ipKey = (ip: string) => `ip:${ip}`;

/**
 * Én felles kilde for e-post/passord-sjekken. Brukes både av NextAuth sin
 * Credentials-provider og av server-actionen på innloggingssiden, slik at
 * reglene (passord må stemme, kontoen må være aktivert) aldri kommer ut av sync.
 *
 * Rekkefølgen er bevisst: legitimasjonen verifiseres først, og feiltellerne
 * brukes bare etterpå. En angriper kan derfor ikke låse en konto ved å fylle
 * e-posttelleren med feil passord – et riktig passord slipper alltid gjennom.
 * Tellerne gjør fortsatt at gjentatte feilforsøk rapporteres som «locked».
 */
export async function verifyCredentials(
  email: string,
  password: string,
  ip?: string
): Promise<CredentialResult> {
  // E-post er ikke case-sensitiv. Normaliser én gang, slik at både
  // rate-limitnøkkelen, oppslaget og feilsøkingen bruker samme verdi.
  const normalizedEmail = cleanEmail(email);

  const user = normalizedEmail
    ? await prisma.user.findUnique({ where: { email: normalizedEmail } })
    : null;

  // Sammenlign alltid mot et hash, også når brukeren eller passordet mangler.
  // Da avhenger ikke responstiden av om e-posten finnes.
  const passwordMatches = await bcrypt.compare(
    password,
    user?.password ?? DUMMY_PASSWORD_HASH
  );
  const credentialsValid = Boolean(
    normalizedEmail && password && user?.password && passwordMatches
  );

  if (credentialsValid && user) {
    // Kontoen må være manuelt aktivert av en administrator.
    if (!user.isActive) return { status: "inactive" };

    // Nullstill bare kontonøkkelen. IP-nøkkelen er delt av alle kontoer bak
    // samme adresse, og å slette den ville fjernet beskyttelsen for andre
    // kontoer. Den får løpe ut vinduet sitt i stedet.
    await resetRateLimitDb(accountKey(normalizedEmail));

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

  // Feil passord eller ukjent konto telles først her, etter verifiseringen.
  // Uten en kjent IP finnes det ingen IP-nøkkel – vi bruker aldri en felles
  // «ukjent»-bøtte som én klient kan tømme for alle.
  const checks: Promise<{ allowed: boolean; retryAfterSeconds: number }>[] = [];
  if (normalizedEmail) {
    checks.push(
      allowRequestDb(
        accountKey(normalizedEmail),
        EMAIL_FAILURE_LIMIT,
        FAILURE_WINDOW_MS
      )
    );
  }
  if (ip) {
    checks.push(allowRequestDb(ipKey(ip), IP_FAILURE_LIMIT, FAILURE_WINDOW_MS));
  }

  const limits = await Promise.all(checks);
  const blocked = limits.filter((limit) => !limit.allowed);
  if (blocked.length > 0) {
    return {
      status: "locked",
      retryAfterSeconds: Math.max(
        ...blocked.map((limit) => limit.retryAfterSeconds)
      ),
    };
  }

  return { status: "invalid" };
}
