import { z } from "zod";
import { LIMITS } from "@/lib/sanitize";
import {
  dateOnlySchema,
  idSchema,
  limitedText,
  optionalIdSchema,
  requiredText,
} from "./common";

const EQUIPMENT_STATUSES = ["ACTIVE", "OUT_OF_SERVICE", "RETIRED"] as const;
const MAINTENANCE_TRIGGERS = ["CALENDAR", "METER"] as const;
const METER_SOURCES = ["MANUAL", "VISIT", "IMPORT"] as const;

/** Ny enhet i utstyrsregisteret. */
export const equipmentCreateSchema = z.object({
  customerId: idSchema,
  model: requiredText(LIMITS.title),
  serialNumber: limitedText(LIMITS.line).default(""),
  location: limitedText(LIMITS.line).default(""),
  categoryId: optionalIdSchema,
  parentId: optionalIdSchema,
  installDate: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    dateOnlySchema.optional(),
  ),
  warrantyUntil: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    dateOnlySchema.optional(),
  ),
  status: z.enum(EQUIPMENT_STATUSES).default("ACTIVE"),
  criticality: z.coerce.number().int().min(1).max(3).default(2),
  meterUnit: limitedText(20).default(""),
});

/**
 * Endring av en enhet. Alle felter er valgfrie, slik at API-et kan sende et
 * lite PATCH-objekt. Tom streng for `categoryId`/`parentId` betyr «fjern».
 */
export const equipmentUpdateSchema = z.object({
  id: idSchema,
  model: requiredText(LIMITS.title).optional(),
  serialNumber: limitedText(LIMITS.line).optional(),
  location: limitedText(LIMITS.line).optional(),
  categoryId: z.string().max(LIMITS.line).optional(),
  parentId: z.string().max(LIMITS.line).optional(),
  installDate: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    dateOnlySchema.nullable().optional(),
  ),
  warrantyUntil: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    dateOnlySchema.nullable().optional(),
  ),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  criticality: z.coerce.number().int().min(1).max(3).optional(),
  meterUnit: limitedText(20).optional(),
});

/** Ny kategori i kategoritreet. */
export const equipmentCategoryCreateSchema = z.object({
  name: requiredText(LIMITS.short),
  parentId: optionalIdSchema,
});

export const equipmentCategoryUpdateSchema = z.object({
  id: idSchema,
  name: requiredText(LIMITS.short),
  parentId: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    idSchema.nullable().optional(),
  ),
});

/** En måling fra utstyret. `readAt` kan være dato eller ISO-tidspunkt. */
export const meterReadingCreateSchema = z.object({
  value: z.coerce.number().finite().min(0),
  readAt: z.string().trim().min(1),
  source: z.enum(METER_SOURCES).default("MANUAL"),
  note: limitedText(LIMITS.text).default(""),
  visitId: optionalIdSchema,
});

/** Ny vedlikeholdsplan. */
export const maintenancePlanCreateSchema = z.object({
  title: requiredText(LIMITS.title),
  trigger: z.enum(MAINTENANCE_TRIGGERS),
  productId: optionalIdSchema,
  customerId: optionalIdSchema,
  departmentId: optionalIdSchema,
  templateId: optionalIdSchema,
  intervalMonths: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(1).max(120).optional(),
  ),
  meterInterval: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().finite().positive().optional(),
  ),
  leadDays: z.coerce.number().int().min(0).max(365).default(14),
  nextDueDate: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    dateOnlySchema.optional(),
  ),
});

export const maintenancePlanUpdateSchema = z.object({
  id: idSchema,
  title: requiredText(LIMITS.title).optional(),
  isActive: z.preprocess(
    (value) => (typeof value === "string" ? value === "true" : value),
    z.boolean().optional(),
  ),
  intervalMonths: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().int().min(1).max(120).nullable().optional(),
  ),
  meterInterval: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().finite().positive().nullable().optional(),
  ),
  leadDays: z.coerce.number().int().min(0).max(365).optional(),
  nextDueDate: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    dateOnlySchema.nullable().optional(),
  ),
  templateId: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    idSchema.nullable().optional(),
  ),
});
