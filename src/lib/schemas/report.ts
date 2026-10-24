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

/** Låse eller låse opp en signert rapport. Årsak kreves ved opplåsing. */
export const reportUnlockSchema = z.object({
  reportId: idSchema,
  lock: z.enum(["0", "1"]).transform((value) => value === "1"),
  reason: limitedText(1000).optional(),
});

/**
 * Grensen for hvor mye rå signaturdata en kladd kan ta imot. Selve kladden
 * lagres uten bildedata (de skrives til `/uploads`), men vi vil ikke bruke
 * minne på vilkårlig store data-URL-er før de avvises.
 */
export const MAX_DRAFT_SIGNATURE_LENGTH = 2_000_000;

/**
 * Feltene en offline-kladd kan inneholde. Samme grenser som innsendingen, slik
 * at en kladd ikke kan brukes til å lagre vesentlig mer enn en rapport.
 */
export const reportDraftSchema = z.object({
  workOrderId: idSchema,
  templateId: idSchema,
  unitsJson: limitedText(500_000).optional(),
  notes: markdownSchema.optional(),
  technicianName: limitedText(LIMITS.title).optional(),
  customerName: limitedText(LIMITS.title).optional(),
  technicianSignature: limitedText(MAX_DRAFT_SIGNATURE_LENGTH).optional(),
  customerSignature: limitedText(MAX_DRAFT_SIGNATURE_LENGTH).optional(),
});
