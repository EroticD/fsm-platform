/**
 * Ren tilstandsmaskin for SLA-klokker. Tidsstemplene er absolutte og er
 * allerede beregnet med åpningstider i `src/lib/business-hours.ts`.
 */

export type SlaClockLike = {
  startedAt: Date;
  respondBy: Date;
  resolveBy: Date;
  respondedAt: Date | null;
  resolvedAt: Date | null;
  breachedAt?: Date | null;
  state?: string | null;
};

export type SlaStateValue =
  | "ON_TRACK"
  | "AT_RISK"
  | "BREACHED"
  | "MET"
  | "CANCELLED";

/** Minst så mange minutter før fristen regnes klokken som «i fare». */
export const SLA_AT_RISK_MIN_MINUTES = 15;
/** Andel av den totale fristen som regnes som faresone. */
export const SLA_AT_RISK_FRACTION = 0.2;

function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

/** Neste frist klokken måler mot: svar før løsning. */
export function slaNextDeadline(
  clock: Pick<SlaClockLike, "respondBy" | "resolveBy" | "respondedAt">,
): { deadline: Date; kind: "response" | "resolution" } {
  if (!clock.respondedAt) {
    return { deadline: clock.respondBy, kind: "response" };
  }
  return { deadline: clock.resolveBy, kind: "resolution" };
}

export function slaStateAt(clock: SlaClockLike, now = new Date()): SlaStateValue {
  if (clock.resolvedAt) {
    const responseOnTime =
      clock.respondedAt === null ||
      clock.respondedAt.getTime() <= clock.respondBy.getTime();
    return clock.resolvedAt.getTime() <= clock.resolveBy.getTime() &&
      responseOnTime
      ? "MET"
      : "BREACHED";
  }

  if (now.getTime() > clock.resolveBy.getTime()) return "BREACHED";
  if (!clock.respondedAt && now.getTime() > clock.respondBy.getTime()) {
    return "BREACHED";
  }
  if (
    clock.respondedAt &&
    clock.respondedAt.getTime() > clock.respondBy.getTime()
  ) {
    return "BREACHED";
  }

  const { deadline } = slaNextDeadline(clock);
  const remaining = minutesBetween(now, deadline);
  const total = Math.max(1, minutesBetween(clock.startedAt, deadline));
  const riskWindow = Math.max(
    SLA_AT_RISK_MIN_MINUTES,
    Math.round(total * SLA_AT_RISK_FRACTION),
  );
  return remaining <= riskWindow ? "AT_RISK" : "ON_TRACK";
}

/** Tidspunktet klokken først brøt en frist, eller null når den ikke er brutt. */
export function slaBreachedAt(
  clock: SlaClockLike,
  now = new Date(),
): Date | null {
  const responseOnTime =
    clock.respondedAt !== null &&
    clock.respondedAt.getTime() <= clock.respondBy.getTime();

  if (!clock.respondedAt && now.getTime() > clock.respondBy.getTime()) {
    return clock.respondBy;
  }
  if (clock.respondedAt && !responseOnTime) return clock.respondBy;
  if (clock.resolvedAt) {
    return clock.resolvedAt.getTime() > clock.resolveBy.getTime()
      ? clock.resolveBy
      : null;
  }
  if (now.getTime() > clock.resolveBy.getTime()) return clock.resolveBy;
  return null;
}

/** Minutter til neste frist. Negativ betyr at fristen er passert. */
export function slaRemainingMinutes(
  clock: SlaClockLike,
  now = new Date(),
): number {
  const { deadline } = slaNextDeadline(clock);
  return minutesBetween(now, deadline);
}

/** Er klokken avsluttet og skal ikke lenger telles i faresonen? */
export function isSlaTerminal(state: string | null | undefined): boolean {
  return state === "MET" || state === "CANCELLED";
}
