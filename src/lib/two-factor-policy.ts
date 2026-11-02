/**
 * Påkrevd to-trinns verifisering for utvalgte roller.
 *
 * `REQUIRE_2FA_ROLES` er en kommaseparert liste, for eksempel
 * `ADMIN,OFFICE`. Tom eller utelatt verdi betyr at 2FA fortsatt er valgfritt.
 * Rollenavn sammenlignes uten hensyn til store/små bokstaver.
 *
 * Policyen gjelder bare innlogging. En økt som allerede var opprettet før
 * policyen ble slått på, lever til den utløper (maks 12 timer) eller til
 * brukeren logger ut. Det er den dokumenterte «grace»-perioden for eldre
 * kontoer.
 */
export function requiredTwoFactorRoles(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.REQUIRE_2FA_ROLES ?? "")
    .split(",")
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean);
}

/** Må denne brukeren ha 2FA for å fullføre innlogging? */
export function requiresTwoFactorEnrollment(
  user: { role?: string | null; isTwoFactorEnabled?: boolean | null },
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (user.isTwoFactorEnabled) return false;
  const role = (user.role ?? "").trim().toUpperCase();
  if (!role) return false;
  return requiredTwoFactorRoles(env).includes(role);
}
