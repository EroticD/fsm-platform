import { z } from "zod";
import { LIMITS } from "@/lib/sanitize";
import { idSchema, limitedText, optionalIdSchema, requiredText } from "./common";

/** Opprette en ansatt eller kundeportalbruker. */
export const userCreateSchema = z.object({
  name: requiredText(LIMITS.title),
  email: z
    .string()
    .trim()
    .min(1, "E-post er påkrevd")
    .max(254, "For lang e-post")
    .email("Ugyldig e-post"),
  phone: limitedText(40).default(""),
  role: requiredText(LIMITS.short),
  departmentId: optionalIdSchema,
  contactId: optionalIdSchema,
});

/** Endre rolle på en bruker. */
export const userRoleSchema = z.object({
  id: idSchema,
  role: requiredText(LIMITS.short),
});

/** Aktivere eller deaktivere en bruker. */
export const userActiveSchema = z.object({
  id: idSchema,
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/** Lagre en tilpasset rettighetsliste. */
export const userPermissionsSchema = z.object({
  id: idSchema,
  permissions: z
    .array(z.string().max(LIMITS.short))
    .max(100, "For mange rettigheter")
    .default([]),
});

/** Endre telefonnummer. */
export const userPhoneSchema = z.object({
  id: idSchema,
  phone: limitedText(40).default(""),
});

/** Invitasjon til en eksisterende bruker. */
export const userInviteSchema = z.object({
  id: idSchema,
});
