import { z } from "zod";

const id = z.string().trim().min(1).max(64);

export const materialSchema = z.object({
  workOrderId: id,
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional().nullable(),
  quantity: z.coerce.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(20).default("stk"),
  // Valgfri: feltbrukere sender ingen pris, og kontoret kan prissette senere.
  // Tom streng regnes som «ingen pris», ikke som 0.
  unitPrice: z.preprocess(
    (value) => (value === "" ? null : value),
    z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  ),
});

export const materialUpdateSchema = materialSchema.partial().extend({
  id,
});

export const materialIdSchema = z.object({ id });
