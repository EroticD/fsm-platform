import { intlLocale } from "@/lib/dates";

/**
 * Formaterer et antall minutter som en kort, lokalisert varighet.
 *
 * Brukes for arbeidstid og reisetid i oppdrags- og feltflatene. Summeringen
 * gjøres av `src/lib/visit-time.ts`; denne hjelperen bare viser tallet.
 * Ukjente verdier vises som en tankestrek, aldri som «0 min».
 */
export function formatDurationMinutes(
  minutes: number | null | undefined,
  locale?: string | null,
  fallback = "–",
): string {
  if (minutes === null || minutes === undefined) return fallback;
  if (!Number.isFinite(minutes)) return fallback;

  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  const hourFormatter = new Intl.NumberFormat(intlLocale(locale), {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  });
  const minuteFormatter = new Intl.NumberFormat(intlLocale(locale), {
    style: "unit",
    unit: "minute",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  });

  if (hours > 0 && rest > 0) {
    return `${hourFormatter.format(hours)} ${minuteFormatter.format(rest)}`;
  }
  if (hours > 0) return hourFormatter.format(hours);
  return minuteFormatter.format(rest);
}
