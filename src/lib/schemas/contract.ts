import { z } from "zod";
import { isContractInterval } from "@/lib/contracts";
import { LIMITS } from "@/lib/sanitize";
import {
  dateOnlySchema,
  idSchema,
  optionalIdSchema,
  requiredText,
} from "./common";

/** Ny serviceavtale. */
export const contractCreateSchema = z.object({
  title: requiredText(LIMITS.title),
  startDate: dateOnlySchema,
  intervalMonths: z.coerce
    .number()
    .int()
    .refine(isContractInterval, "Ugyldig intervall"),
  departmentId: optionalIdSchema,
  contactId: optionalIdSchema,
  templateId: optionalIdSchema,
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
