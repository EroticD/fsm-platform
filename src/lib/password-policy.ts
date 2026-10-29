/**
 * Felles passordpolicy for alle steder der brukeren setter et nytt passord.
 *
 * bcrypt bruker bare de første 72 bytene av passordet. Uten en eksplisitt
 * øvre grense ville to ulike passord med samme 72-byte-prefiks vært
 * likeverdige, og brukeren kunne tro at hele passordet var i bruk.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordPolicyError = "too_short" | "too_long" | "whitespace";

/**
 * Returnerer feilen, eller `null` når passordet er gyldig.
 *
 * Ledende eller avsluttende mellomrom avvises i stedet for å trimmes, slik
 * at passordet brukeren skrev faktisk er passordet som lagres.
 */
export function validatePassword(value: unknown): PasswordPolicyError | null {
  const password = typeof value === "string" ? value : "";

  if (password.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (password !== password.trim()) return "whitespace";

  // TextEncoder teller UTF-8-bytes, også for tegn utenfor BMP.
  const bytes = new TextEncoder().encode(password).length;
  if (bytes > PASSWORD_MAX_BYTES) return "too_long";

  return null;
}
