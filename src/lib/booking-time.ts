/**
 * Felles tidsberegning for kundebestillinger. Ligger utenfor tjenestelagene
 * fordi både portalen, kontorkøen og revisjonsloggen trenger de samme
 * absoluttidspunktene uten å importere Prisma.
 */

import { osloWallTimeToUtc } from "@/lib/business-hours";
import { parseDateOnly, toDateOnly } from "@/lib/dates";

export const BOOKING_TIME_VALUE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type BookingSchedule = {
  requestedDate: Date;
  requestedFrom: string;
  requestedTo: string;
};

export function timeToMinute(value: string): number | null {
  const match = BOOKING_TIME_VALUE.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minuteToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60,
  ).padStart(2, "0")}`;
}

/** Absolutt starttidspunkt for et ønsket tidsvindu i Oslo. */
export function requestedWindow(schedule: {
  requestedDate: Date;
  requestedFrom: string;
  requestedTo: string;
}): { startsAt: Date; endsAt: Date } {
  const date = toDateOnly(schedule.requestedDate);
  return {
    startsAt: osloWallTimeToUtc(date, timeToMinute(schedule.requestedFrom) ?? 0),
    endsAt: osloWallTimeToUtc(date, timeToMinute(schedule.requestedTo) ?? 0),
  };
}

/** Fristen for å be om ny tid på bestillingen (24 timer før start). */
export function bookingChangeDeadline(
  requestedDate: Date,
  requestedFrom: string,
  cutoffHours = 24,
): Date {
  const date = toDateOnly(requestedDate);
  const minute = timeToMinute(requestedFrom) ?? 0;
  return new Date(
    osloWallTimeToUtc(date, minute).getTime() - cutoffHours * 60 * 60_000,
  );
}

/** Datoen som UTC-midnatt, slik BookingRequest.requestedDate lagres. */
export function parseBookingDate(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return parseDateOnly(text);
}
