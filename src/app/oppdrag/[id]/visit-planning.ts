import {
  addDaysUtc,
  dateOnlyInOslo,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";

/**
 * Skjemahjelpere for visitter på kontorets oppdragsside.
 *
 * Dato og klokkeslett sendes som separate felt og tolkes alltid i
 * Europe/Oslo. Da kan ikke nettleserens tidssone flytte en visitt, og
 * oppdragets avledede datoperiode kan ikke redigeres direkte fra skjemaet.
 */

export type VisitPeriod = {
  startsAt: Date;
  endsAt: Date;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const osloTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTruthy(value: string): boolean {
  return value === "true" || value === "on" || value === "1";
}

/** Tolker en Oslo-dato og et klokkeslett som ett UTC-tidspunkt. */
export function parseOsloDateTime(
  dateValue: unknown,
  timeValue: unknown,
): Date | null {
  const dateText = typeof dateValue === "string" ? dateValue.trim() : "";
  const timeText = typeof timeValue === "string" ? timeValue.trim() : "";
  if (!parseDateOnly(dateText)) return null;

  const match = TIME_PATTERN.exec(timeText);
  if (!match) return null;

  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return new Date(osloDayStart(dateText).getTime() + minutes * 60_000);
}

/**
 * Leser et tidsrom fra skjemaet. Heldagsvisitter bruker datoene og en
 * eksklusiv slutt ved midnatt etter siste dag. Tidsvisitter krever begge
 * klokkeslettene. `endsOn` er valgfritt og betyr samme dag.
 */
export function visitPeriodFromForm(
  formData: FormData,
  options: { allDay?: boolean } = {},
): VisitPeriod | null {
  const startsOn = formText(formData.get("startsOn"));
  const endsOn = formText(formData.get("endsOn")) || startsOn;
  const allDay =
    options.allDay ??
    isTruthy(formText(formData.get("allDay")));

  const startDate = parseDateOnly(startsOn);
  const endDate = parseDateOnly(endsOn);
  if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) {
    return null;
  }

  if (allDay) {
    return {
      startsAt: osloDayStart(startsOn),
      endsAt: osloDayStart(toDateOnly(addDaysUtc(endDate, 1))),
    };
  }

  const startsAt = parseOsloDateTime(startsOn, formData.get("startTime"));
  const endsAt = parseOsloDateTime(endsOn, formData.get("endTime"));
  if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
    return null;
  }

  return { startsAt, endsAt };
}

/** Datoen en visitt starter på, i Oslo, klar for `<input type="date">`. */
export function visitDateInput(value: Date): string {
  return dateOnlyInOslo(value);
}

/** Klokkeslettet en visitt starter eller slutter på, i Oslo. */
export function visitTimeInput(value: Date): string {
  return osloTimeFormatter.format(value);
}

/** Siste inkluderte dag i et halvåpent visittintervall. */
export function lastIncludedVisitDate(value: Date): string {
  return dateOnlyInOslo(new Date(value.getTime() - 1));
}

/**
 * Gjør en tjenestefeil om til en stabil slug som siden kan oversette.
 * Tjenestene legger den spesifikke årsaken i `details.code`.
 */
export function visitFailureSlug(failure: {
  reason: string;
  details?: unknown;
}): string {
  const details = failure.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") {
      const segment = code.split(".").pop();
      if (segment) return segment;
    }
  }
  if (failure.reason === "not_found") return "notFound";
  if (failure.reason === "forbidden") return "forbidden";
  return failure.reason || "generic";
}
