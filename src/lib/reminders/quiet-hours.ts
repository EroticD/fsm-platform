/**
 * Stille timer for påminnelser. Timene er lokale i avdelingens tidssone, og
 * et vindu som starter senere enn det slutter går over midnatt (22 → 07).
 */
export function isWithinQuietHours(
  date: Date,
  startHour: number | null,
  endHour: number | null,
  timeZone: string,
): boolean {
  if (startHour === null || endHour === null) return false;
  const start = Math.max(0, Math.min(23, Math.trunc(startHour)));
  const end = Math.max(0, Math.min(23, Math.trunc(endHour)));
  if (start === end) return false;

  const hour = localHour(date, timeZone);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Neste tidspunkt utenfor stille periode, eller samme tidspunkt. */
export function deferForQuietHours(
  date: Date,
  startHour: number | null,
  endHour: number | null,
  timeZone: string,
): Date {
  if (!isWithinQuietHours(date, startHour, endHour, timeZone)) return date;

  const start = Math.max(0, Math.min(23, Math.trunc(startHour ?? 0)));
  const end = Math.max(0, Math.min(23, Math.trunc(endHour ?? 0)));
  const { hour, minute } = localTime(date, timeZone);
  const nowMinutes = hour * 60 + minute;
  let deltaMinutes = end * 60 - nowMinutes;
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;

  // Flytt i små steg over eventuelle sommertidsoverganger, slik at vi lander
  // på riktig lokal time også når klokken stilles.
  let shifted = new Date(date.getTime() + deltaMinutes * 60_000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isWithinQuietHours(shifted, start, end, timeZone)) break;
    const current = localTime(shifted, timeZone);
    const currentMinutes = current.hour * 60 + current.minute;
    let extra = end * 60 - currentMinutes;
    if (extra <= 0) extra += 24 * 60;
    shifted = new Date(shifted.getTime() + extra * 60_000);
  }
  return shifted;
}

function localHour(date: Date, timeZone: string): number {
  return localTime(date, timeZone).hour;
}

function localTime(
  date: Date,
  timeZone: string,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value("hour"), minute: value("minute") };
}
