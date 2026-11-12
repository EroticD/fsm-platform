/**
 * Felles regler for offline-registrering av visittstatus.
 *
 * Modulen er bevisst uten avhengigheter til IndexedDB, React eller serverkode,
 * slik at klientkøen og serveractionen validerer nøyaktig samme kontrakt.
 * Fullføring av en økt er ikke med: den krever rapport og PDF og går alltid
 * gjennom den vanlige, nettavhengige flyten.
 */

/** Statusene en montør kan tidfeste uten nett. */
export const OFFLINE_VISIT_STATUSES = ["EN_ROUTE", "ON_SITE"] as const;

export type OfflineVisitStatus = (typeof OFFLINE_VISIT_STATUSES)[number];

/**
 * Hvor langt fram i tid et klienttidsstempel kan ligge. Klokken på telefonen
 * kan gå noen minutter feil uten at tidspunktet er useriøst.
 */
export const VISIT_STATUS_MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Hvor gammelt et klienttidsstempel kan være. En registrering som har ligget
 * mer enn et døgn i køen, kan ikke lenger tidfestes troverdig.
 */
export const VISIT_STATUS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Hvorfor et tidsstempel ikke kan brukes. */
export type VisitStatusTimestampProblem = "invalid" | "in-future" | "too-old";

/**
 * Svar fra serveractionen på en køet registrering.
 *
 * `retryable` skiller et nettbrudd fra en definitiv avvisning (ugyldig
 * overgang, manglende tilgang, slettet visitt). Bare det første skal bli
 * liggende i køen og prøves igjen.
 */
export type VisitStatusSendResult =
  | { ok: true }
  | { ok: false; retryable: boolean; error?: string };

/** Er verdien en status montøren kan registrere offline? */
export function isOfflineVisitStatus(
  value: unknown,
): value is OfflineVisitStatus {
  return (OFFLINE_VISIT_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Kontrollerer montørens tidsstempel (epoch ms).
 *
 * Grensene er inklusive: et tidspunkt nøyaktig 24 timer tilbake eller nøyaktig
 * fem minutter fram er fortsatt gyldig. `now` injiseres i tester.
 */
export function visitStatusTimestampProblem(
  at: number,
  now = Date.now(),
): VisitStatusTimestampProblem | null {
  if (!Number.isFinite(at) || at <= 0) return "invalid";
  if (!Number.isFinite(now)) return "invalid";
  if (at - now > VISIT_STATUS_MAX_FUTURE_MS) return "in-future";
  if (now - at > VISIT_STATUS_MAX_AGE_MS) return "too-old";
  return null;
}

/**
 * Idempotensnøkkel for køen: samme visitt, status og tidspunkt gir samme
 * oppføring, uansett hvor mange ganger handlingen prøves lagt inn.
 */
export function visitStatusKey(
  visitId: string,
  status: OfflineVisitStatus,
  at: number,
): string {
  return `${visitId}:${status}:${at}`;
}
