import { toDateOnly } from "@/lib/dates";
import { osloWallTimeToUtc } from "@/lib/business-hours";

/** Standard starttid for en ny visitt: kl. 08:00 i Europe/Oslo. */
export const DEFAULT_VISIT_START_MINUTES = 8 * 60;
/** Standard varighet for en ny visitt: fire timer. */
export const DEFAULT_VISIT_DURATION_MINUTES = 4 * 60;

/**
 * Standardtidsblokken når et oppdrag opprettes.
 *
 * Datoen er en ren kalenderdato i Oslo. Start og slutt regnes som veggklokketid
 * i Oslo, slik at blokken holder 08:00–12:00 også over sommertid. Den er ikke
 * en heldagsvisitt; kontoret kan justere tidene etterpå.
 */
export function defaultVisitWindow(date: Date): {
  startsAt: Date;
  endsAt: Date;
} {
  const dateOnly = toDateOnly(date);
  return {
    startsAt: osloWallTimeToUtc(
      dateOnly,
      DEFAULT_VISIT_START_MINUTES,
    ),
    endsAt: osloWallTimeToUtc(
      dateOnly,
      DEFAULT_VISIT_START_MINUTES + DEFAULT_VISIT_DURATION_MINUTES,
    ),
  };
}
