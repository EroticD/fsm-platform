import { z } from "zod";
import { LIMITS } from "@/lib/sanitize";
import { idSchema, limitedText, markdownSchema, optionalIdSchema, requiredText } from "./common";

const optionalLine = limitedText(LIMITS.line);

/** Ny kunde fra kundekatalogen. */
export const customerCreateSchema = z.object({
  name: requiredText(LIMITS.title),
  orgNumber: optionalLine.default(""),
  departmentId: optionalIdSchema,
  responsibleTechnicianId: optionalIdSchema,
});

/** Redigering av kundekortet. */
export const customerUpdateSchema = z.object({
  name: requiredText(LIMITS.title),
  customerNumber: optionalLine.default(""),
  orgNumber: optionalLine.default(""),
  brandColor: limitedText(20).default(""),
  address: optionalLine.default(""),
  postalCode: limitedText(20).default(""),
  city: limitedText(LIMITS.short).default(""),
  phone: limitedText(40).default(""),
  email: limitedText(254).default(""),
  notes: markdownSchema.default(""),
  departmentId: optionalIdSchema,
  responsibleTechnicianId: optionalIdSchema,
});

/** Ny kontaktperson på et kundekort. */
export const contactCreateSchema = z.object({
  name: requiredText(LIMITS.title),
  email: limitedText(254).default(""),
  phone: limitedText(40).default(""),
  role: limitedText(LIMITS.short).default(""),
});

/** Endring av en kontaktperson. */
export const contactUpdateSchema = contactCreateSchema.extend({
  id: idSchema,
});
