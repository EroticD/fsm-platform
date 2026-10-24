import { z } from "zod";
import { LIMITS, WORK_STATUSES } from "@/lib/sanitize";

/**
 * Felles byggeklosser for skjemavalidering.
 *
 * Skjemaene kjøres på verdier som allerede er renset med `src/lib/sanitize.ts`.
 * De kontrollerer form og lengde, mens rensingen fortsatt er ansvarlig for å
 * fjerne HTML og farlige tegn. Da får vi både en trygg lagring og en tydelig
 * feil når noe mangler.
 */

/** En id som må finnes (cuid/uuid eller tilsvarende). */
export const idSchema = z
  .string()
  .trim()
  .min(1, "Mangler id")
  .max(LIMITS.line, "For lang id");

/** En valgfri id. Tom streng, null og undefined blir `undefined`. */
export const optionalIdSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  idSchema.optional(),
);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Dato på formatet YYYY-MM-DD, med kontroll av at datoen faktisk finnes. */
export const dateOnlySchema = z
  .string()
  .trim()
  .regex(DATE_ONLY, "Ugyldig dato")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Ugyldig dato");

/** Valgfri dato. Tom streng, null og undefined blir `undefined`. */
export const optionalDateOnlySchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  dateOnlySchema.optional(),
);

/** Kort tekst med en øvre grense. */
export function limitedText(maxLength: number = LIMITS.text) {
  return z.string().max(maxLength, "For lang tekst");
}

/** Fritekst som kan inneholde Markdown. */
export const markdownSchema = limitedText(LIMITS.markdown);

/** En tekst som må ha innhold. */
export function requiredText(maxLength: number = LIMITS.title) {
  return z
    .string()
    .trim()
    .min(1, "Feltet er påkrevd")
    .max(maxLength, "For lang tekst");
}

/** Gyldig oppdragsstatus (samme verdier som WorkStatus i Prisma). */
export const workStatusSchema = z.enum(WORK_STATUSES);
