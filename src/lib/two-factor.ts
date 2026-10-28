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

/** Verifiserer en 6-sifret TOTP-kode mot hemmeligheten. */
export function verifyTotp(secret: string, token: string): boolean {
  const cleaned = String(token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const result = verifySync({ secret, token: cleaned });
    return result.valid;
  } catch {
    return false;
  }
}

/** Bygger otpauth://-URI som QR-koden kodes fra. */
export function buildTotpUri(secret: string, email: string, issuer = "FSM"): string {
  return generateURI({ secret, label: email, issuer });
}

/** Genererer en kode – brukes i tester. */
export function generateTotp(secret: string): string {
  return generateSync({ secret });
}
