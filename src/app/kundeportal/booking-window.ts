export const FIRST_BOOKING_MINUTES = 7 * 60;
export const LAST_BOOKING_START_MINUTES = 17 * 60 + 30;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Tidligste starttid skjemaet kan tilby, regnet i Oslo-tid og rundet opp til
 * neste halvtime. Serveren håndhever den eksakte ledetiden.
 */
export function minimumBookingStart(
  leadHours: number,
  now = new Date(),
) {
  const threshold = new Date(
    now.getTime() + leadHours * 60 * 60_000 + 60_000,
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(threshold);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);

  let date = `${part("year")}-${pad2(part("month"))}-${pad2(part("day"))}`;
  let minutes = Math.max(
    FIRST_BOOKING_MINUTES,
    Math.ceil((part("hour") * 60 + part("minute")) / 30) * 30,
  );
  if (minutes > LAST_BOOKING_START_MINUTES) {
    const nextDay = new Date(`${date}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    date = nextDay.toISOString().slice(0, 10);
    minutes = FIRST_BOOKING_MINUTES;
  }

  return {
    date,
    from: `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`,
  };
}
