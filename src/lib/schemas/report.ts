import { z } from "zod";
import { LIMITS } from "@/lib/sanitize";
import { idSchema, limitedText, markdownSchema } from "./common";

/**
 * Innsending av en rapport. Selve svarene ligger i `unitsJson` og valideres av
 * rapportlogikken; her kontrolleres id-er og størrelsen på feltene.
 */
export const reportSubmitSchema = z.object({
  workOrderId: idSchema,
  templateId: idSchema,
  unitsJson: limitedText(500_000).optional(),
  notes: markdownSchema.optional(),
  returnTo: limitedText(LIMITS.line).optional(),
});

/** Låse eller låse opp en signert rapport. */
export const reportUnlockSchema = z.object({
  reportId: idSchema,
  lock: z.enum(["0", "1"]).transform((value) => value === "1"),
});
