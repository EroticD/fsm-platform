import { z } from "zod";
import { isContractInterval } from "@/lib/contracts";
import { LIMITS } from "@/lib/sanitize";
import {
  dateOnlySchema,
  idSchema,
  optionalDateOnlySchema,
  optionalIdSchema,
  requiredText,
} from "./common";

const CONTRACT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "EXPIRED",
  "TERMINATED",
] as const;

const RENEWAL_MODES = ["AUTO", "MANUAL"] as const;

function optionalInteger(min: number, max: number) {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.coerce.number().int().min(min).max(max).optional(),
  );
}

function optionalPercent() {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.coerce.number().min(-100).max(100).optional(),
  );
}

/** Ny serviceavtale. */
export const contractCreateSchema = z.object({
  title: requiredText(LIMITS.title),
  contractNumber: z.string().max(LIMITS.line).optional(),
  startDate: dateOnlySchema,
  endDate: optionalDateOnlySchema,
  intervalMonths: z.coerce
    .number()
    .int()
    .refine(isContractInterval, "Ugyldig intervall"),
  departmentId: optionalIdSchema,
  contactId: optionalIdSchema,
  templateId: optionalIdSchema,
  slaPolicyId: optionalIdSchema,
  priceListId: optionalIdSchema,
  status: z.enum(CONTRACT_STATUSES).optional(),
  renewalMode: z.enum(RENEWAL_MODES).optional(),
  noticeDays: optionalInteger(0, 3650),
  indexationPercent: optionalPercent(),
});

/** Full redigering av en serviceavtale. */
export const contractUpdateSchema = contractCreateSchema.extend({
  id: idSchema,
  status: z.enum(CONTRACT_STATUSES).optional(),
  renewalMode: z.enum(RENEWAL_MODES).optional(),
  noticeDays: optionalInteger(0, 3650),
  indexationPercent: optionalPercent(),
});

/** Pause eller gjenoppta en serviceavtale. */
export const contractToggleSchema = z.object({
  id: idSchema,
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/** Slette en serviceavtale. */
export const contractDeleteSchema = z.object({
  id: idSchema,
});

/** En dekket enhet/alt utstyr på en avtale. */
export const contractLineCreateSchema = z.object({
  contractId: idSchema,
  productId: optionalIdSchema,
  scope: z.string().max(LIMITS.text).optional(),
  visitsPerYear: optionalInteger(0, 1000),
  responseMinutes: optionalInteger(0, 60 * 24 * 366),
  resolutionMinutes: optionalInteger(0, 60 * 24 * 366),
});

export const contractLineDeleteSchema = z.object({
  id: idSchema,
  contractId: idSchema,
});

/** Prislister er referansedata – ingen fakturering. */
export const priceListCreateSchema = z.object({
  name: requiredText(LIMITS.title),
  isActive: z.enum(["true", "false"]).optional(),
});

export const priceListItemCreateSchema = z.object({
  priceListId: idSchema,
  code: requiredText(LIMITS.short),
  label: requiredText(LIMITS.title),
  unit: requiredText(LIMITS.short),
  amount: z.coerce.number().min(0).max(99_999_999),
});

export const priceListItemDeleteSchema = z.object({
  id: idSchema,
  priceListId: idSchema,
});
