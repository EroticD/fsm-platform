import { generateSecret, generateSync, verifySync, generateURI } from "otplib";

/** Antall sekunder en TOTP-kode er gyldig (standard 30). */
export const TOTP_PERIOD = 30;

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
