import type { Prisma } from "@prisma/client";
import { generateSecret, generateSync, verifySync, generateURI } from "otplib";

/** Antall sekunder en TOTP-kode er gyldig (standard 30). */
export const TOTP_PERIOD = 30;

/** Hvor lenge et påbegynt 2FA-oppsett kan bekreftes (10 minutter). */
export const TWO_FACTOR_SETUP_TTL_MS = 10 * 60_000;

/** Er et påbegynt 2FA-oppsett fortsatt innenfor tidsgrensen? */
export function isTwoFactorSetupFresh(
  startedAt: Date | null | undefined,
  now = Date.now(),
): boolean {
  if (!startedAt) return false;
  return now - startedAt.getTime() <= TWO_FACTOR_SETUP_TTL_MS;
}

/** Lager en ny base32-hemmelighet for TOTP. */
export function createTotpSecret(): string {
  return generateSecret();
}

export type TotpStepResult =
  | { valid: false }
  | { valid: true; timeStep: number };

/**
 * Verifiserer en 6-sifret TOTP-kode og returnerer tidssteget koden tilhører.
 *
 * `afterTimeStep` er det siste steget som allerede er godtatt. otplib avviser
 * da koder fra dette steget og tidligere, slik at en avlyttet kode ikke kan
 * brukes om igjen innenfor de samme 30 sekundene.
 */
export function verifyTotpStep(
  secret: string,
  token: string,
  afterTimeStep?: number | null,
): TotpStepResult {
  const cleaned = String(token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return { valid: false };
  try {
    const result = verifySync({
      secret,
      token: cleaned,
      ...(typeof afterTimeStep === "number"
        ? { afterTimeStep }
        : {}),
    });
    const timeStep = (result as { timeStep?: unknown }).timeStep;
    return result.valid && typeof timeStep === "number"
      ? { valid: true, timeStep }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}

/** Verifiserer en 6-sifret TOTP-kode mot hemmeligheten. */
export function verifyTotp(
  secret: string,
  token: string,
  afterTimeStep?: number | null,
): boolean {
  return verifyTotpStep(secret, token, afterTimeStep).valid;
}

/**
 * Lagrer tidssteget atomisk som godtatt.
 *
 * Betingelsen krever at steget er nyere enn det som ligger i databasen. To
 * samtidige innlogginger med samme kode kan derfor ikke begge lykkes.
 */
export async function acceptTotpTimeStep(
  tx: Pick<Prisma.TransactionClient, "user">,
  userId: string,
  timeStep: number,
): Promise<boolean> {
  if (!Number.isInteger(timeStep) || timeStep < 0) return false;
  const updated = await tx.user.updateMany({
    where: {
      id: userId,
      OR: [
        { lastTotpTimeStep: null },
        { lastTotpTimeStep: { lt: timeStep } },
      ],
    },
    data: { lastTotpTimeStep: timeStep },
  });
  return updated.count === 1;
}

/** Bygger otpauth://-URI som QR-koden kodes fra. */
export function buildTotpUri(secret: string, email: string, issuer = "FSM"): string {
  return generateURI({ secret, label: email, issuer });
}

/** Genererer en kode – brukes i tester. */
export function generateTotp(secret: string): string {
  return generateSync({ secret });
}
