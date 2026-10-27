import { randomInt } from "node:crypto";

/** Rapportnummer brukt på HMS-rapporter: tre små bokstaver og fire tall. */
export const REPORT_NUMBER_PATTERN = /^[a-z]{3}\d{4}$/;

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Genererer et tilfeldig rapportnummer på formatet abc1234.
 *
 * Unikhet håndheves av databasen. Kallstedet må håndtere en sjelden kollisjon
 * ved å prøve et nytt nummer.
 */
export function generateReportNumber(): string {
  let letters = "";
  for (let index = 0; index < 3; index += 1) {
    letters += LETTERS[randomInt(0, LETTERS.length)];
  }
  const digits = randomInt(0, 10_000).toString().padStart(4, "0");
  return `${letters}${digits}`;
}

export function isReportNumber(value: unknown): value is string {
  return typeof value === "string" && REPORT_NUMBER_PATTERN.test(value);
}
