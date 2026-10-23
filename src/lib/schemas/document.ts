import { z } from "zod";
import { LIMITS } from "@/lib/sanitize";
import { idSchema, limitedText, optionalIdSchema, requiredText } from "./common";

const tagNamesSchema = z
  .array(z.string().trim().min(1).max(LIMITS.short))
  .max(100, "For mange tags")
  .default([]);

const fileSizeSchema = z.coerce.number().int().min(0).max(2_000_000_000).default(0);

/** Opprette et dokument. */
export const documentCreateSchema = z.object({
  title: requiredText(LIMITS.title),
  description: limitedText(LIMITS.text).default(""),
  fileUrl: z.string().trim().min(1, "Filen mangler").max(LIMITS.line),
  fileName: limitedText(LIMITS.line).default(""),
  fileSize: fileSizeSchema,
  folderId: optionalIdSchema,
  tagNames: tagNamesSchema,
});

/** Oppdatere et dokument. */
export const documentUpdateSchema = documentCreateSchema.extend({
  id: idSchema,
  // Filen er valgfri ved redigering; den beholdes hvis feltet er tomt.
  fileUrl: z.string().trim().max(LIMITS.line).default(""),
});

/** Opprette en dokumentmappe. */
export const documentFolderCreateSchema = z.object({
  name: requiredText(LIMITS.title),
});

/** Slette en mappe eller et dokument. */
export const documentIdSchema = z.object({
  id: idSchema,
});

/** Gjenopprette en tidligere dokumentversjon. */
export const documentVersionSchema = z.object({
  versionId: idSchema,
});
