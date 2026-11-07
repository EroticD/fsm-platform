/**
 * Konfigurasjon for den automatiske SLA-oppryddingen.
 *
 * Modulen er ren og leser bare miljøvariabler, slik at scheduler, metrics og
 * dokumentasjon kan bruke samme standarder uten å importere Prisma.
 */

export const SLA_CLEANUP_DEFAULT_INTERVAL_HOURS = 6;
export const SLA_CLEANUP_MIN_INTERVAL_HOURS = 1 / 60;
export const SLA_CLEANUP_MAX_INTERVAL_HOURS = 7 * 24;

function disabledValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "off" ||
    normalized === "no"
  );
}

/** Oppryddingen er på som standard; `SLA_CLEANUP_ENABLED=false` slår den av. */
export function slaCleanupEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !disabledValue(env.SLA_CLEANUP_ENABLED);
}

/**
 * Hvor ofte oppryddingen skal kjøre. `SLA_CLEANUP_INTERVAL_HOURS` kan være
 * desimaltall (0,5 = hvert 30. minutt) og klemmes til 1 minutt–7 døgn.
 */
export function slaCleanupIntervalMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number.parseFloat(env.SLA_CLEANUP_INTERVAL_HOURS ?? "");
  const hours = Number.isFinite(parsed) && parsed > 0
    ? Math.min(
        Math.max(parsed, SLA_CLEANUP_MIN_INTERVAL_HOURS),
        SLA_CLEANUP_MAX_INTERVAL_HOURS,
      )
    : SLA_CLEANUP_DEFAULT_INTERVAL_HOURS;
  return Math.round(hours * 60 * 60_000);
}

/**
 * Hvor gammel siste kjøring kan bli før metrics flagger den som utdatert.
 * To intervaller gir rom for én forsinket eller mislykket kjøring, pluss en
 * times slark for treg oppstart og deploy.
 */
export function slaCleanupMaxAgeMs(
  env: Record<string, string | undefined> = process.env,
): number {
  return slaCleanupIntervalMs(env) * 2 + 60 * 60_000;
}

/** True når det er gått minst ett intervall siden forrige kjøring startet. */
export function slaCleanupIsDue(
  lastStartedAt: Date | null | undefined,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!lastStartedAt) return true;
  return now.getTime() - lastStartedAt.getTime() >= slaCleanupIntervalMs(env);
}
