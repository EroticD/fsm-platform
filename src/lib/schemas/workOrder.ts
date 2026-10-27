import { z } from "zod";
import { LIMITS } from "@/lib/sanitize";
import {
  dateOnlySchema,
  idSchema,
  markdownSchema,
  optionalDateOnlySchema,
  optionalIdSchema,
  requiredText,
  workStatusSchema,
} from "./common";

const tagNamesSchema = z
  .array(z.string().trim().min(1).max(LIMITS.short))
  .max(100, "For mange tags")
  .default([]);

const idListSchema = z.array(idSchema).max(200, "For mange valgte rader").default([]);

/** Opprette et oppdrag fra kontoret. */
export const workOrderCreateSchema = z
  .object({
    title: requiredText(LIMITS.title),
    orderNumber: z.string().trim().max(LIMITS.line).optional().default(""),
    description: markdownSchema.default(""),
    departmentId: idSchema,
    customerId: optionalIdSchema,
    contactId: optionalIdSchema,
    scheduledFor: dateOnlySchema,
    scheduledTo: optionalDateOnlySchema,
    technicianIds: idListSchema,
    templateIds: idListSchema,
    tagNames: tagNamesSchema,
  })
  .refine(
    (data) => !data.scheduledTo || data.scheduledTo >= data.scheduledFor,
    { message: "Sluttdato kan ikke være før startdato", path: ["scheduledTo"] },
  );

/** Redigere et eksisterende oppdrag. */
export const workOrderUpdateSchema = z
  .object({
    id: idSchema,
    title: requiredText(LIMITS.title),
    orderNumber: z.string().trim().max(LIMITS.line).optional().default(""),
    description: markdownSchema.default(""),
    departmentId: idSchema,
    // Kunden er valgfri også ved redigering, slik at interne oppdrag uten
    // kunde kan lagres uten å måtte knyttes til en kunde.
    customerId: optionalIdSchema,
    contactId: optionalIdSchema,
    scheduledFor: optionalDateOnlySchema,
    scheduledTo: optionalDateOnlySchema,
    technicianIds: idListSchema,
    tagNames: tagNamesSchema,
  })
  .refine(
    (data) =>
      !data.scheduledFor ||
      !data.scheduledTo ||
      data.scheduledTo >= data.scheduledFor,
    { message: "Sluttdato kan ikke være før startdato", path: ["scheduledTo"] },
  );

/** Bytte status på et oppdrag. */
export const workOrderStatusSchema = z.object({
  status: workStatusSchema,
});

/** Flytte et oppdrag i kalenderen. `newEnd` kan være tom for å fjerne sluttdato. */
export const workOrderDateSchema = z
  .object({
    newDate: dateOnlySchema,
    newEnd: optionalDateOnlySchema,
  })
  .refine((data) => !data.newEnd || data.newEnd >= data.newDate, {
    message: "Sluttdato kan ikke være før startdato",
    path: ["newEnd"],
  });

/** Knytte en sjekklistemal til et oppdrag. */
export const workOrderTemplateSchema = z.object({
  templateId: idSchema,
});
