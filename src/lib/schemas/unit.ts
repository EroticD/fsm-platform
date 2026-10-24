import { z } from "zod";
import { LIMITS } from "@/lib/sanitize";
import { idSchema, limitedText, requiredText } from "./common";

const unitFields = {
  customerId: idSchema,
  model: requiredText(LIMITS.title),
  serialNumber: limitedText(LIMITS.line).default(""),
  location: limitedText(LIMITS.line).default(""),
};

/** Ny enhet på et kundekort. */
export const unitCreateSchema = z.object(unitFields);

/** Endring av en enhet. */
export const unitUpdateSchema = z.object({
  ...unitFields,
  id: idSchema,
});
