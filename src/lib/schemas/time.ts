import { z } from "zod";

const id = z.string().trim().min(1).max(64);

const timeEntryBaseSchema = z.object({
  workOrderId: id,
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional().nullable(),
  minutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  billable: z.boolean().optional(),
  hourlyRate: z.coerce.number().min(0).max(100_000).optional().nullable(),
});

export const timeEntrySchema = timeEntryBaseSchema.refine(
  (value) => Boolean(value.endedAt) || value.minutes !== undefined,
  {
    message: "minutes kreves når endedAt mangler",
    path: ["minutes"],
  },
);

export const timeEntryUpdateSchema = timeEntryBaseSchema.partial().extend({
  id,
});

export const timeEntryIdSchema = z.object({ id });
