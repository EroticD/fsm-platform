import { z } from "zod";

const id = z.string().trim().min(1).max(64);

export const materialSchema = z.object({
  workOrderId: id,
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional().nullable(),
  quantity: z.coerce.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(20).default("stk"),
  unitPrice: z.coerce.number().min(0).max(10_000_000),
});

export const materialUpdateSchema = materialSchema.partial().extend({
  id,
});

export const materialIdSchema = z.object({ id });
