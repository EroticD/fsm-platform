import type { HmsFormType, TemplateCategory } from "@prisma/client";
import { isHmsFormType } from "@/lib/hms";

/**
 * Kategori og HMS-type for sjekklistemaler.
 *
 * Maladministrasjonen tar imot denne informasjonen fra et skjema. Reglene
 * holdes i rene funksjoner slik at de kan testes uten database, og slik at
 * både tjenestelaget og UI-et bruker samme definisjon av gyldige verdier.
 */

export const TEMPLATE_CATEGORIES = ["SERVICE", "HMS"] as const;

export function isTemplateCategory(value: unknown): value is TemplateCategory {
  return value === "SERVICE" || value === "HMS";
}

/** Kategorifilteret i URL-en. Ukjent eller tom verdi betyr «alle». */
export function parseTemplateCategoryFilter(
  value: unknown,
): TemplateCategory | null {
  return isTemplateCategory(value) ? value : null;
}

export type TemplateClassification = {
  category: TemplateCategory;
  hmsType: HmsFormType | null;
};

/**
 * Normaliserer kategori og HMS-type.
 *
 * - Tom kategori bruker `defaultCategory` (SERVICE for nye maler).
 * - Ukjent kategori avvises.
 * - SERVICE tvinger `hmsType` til null, slik at service-maler aldri blir
 *   liggende med en HMS-type.
 * - HMS krever en gyldig `HmsFormType`.
 *
 * Returnerer `null` når noe er ugyldig, slik at tjenestelaget kan svare
 * `invalid` uten å skrive noe til databasen.
 */
export function resolveTemplateClassification(input: {
  category?: unknown;
  hmsType?: unknown;
  defaultCategory?: TemplateCategory;
}): TemplateClassification | null {
  const rawCategory =
    typeof input.category === "string"
      ? input.category.trim()
      : input.category;
  const category =
    rawCategory === undefined || rawCategory === null || rawCategory === ""
      ? (input.defaultCategory ?? "SERVICE")
      : rawCategory;

  if (!isTemplateCategory(category)) return null;

  if (category === "SERVICE") {
    return { category: "SERVICE", hmsType: null };
  }

  const rawHmsType =
    typeof input.hmsType === "string" ? input.hmsType.trim() : input.hmsType;
  if (!isHmsFormType(rawHmsType)) return null;

  return { category: "HMS", hmsType: rawHmsType };
}

/** Oversettelsesnøkkelen for en HMS-type i maladministrasjonen. */
export function hmsTypeLabelKey(type: HmsFormType): string {
  return `settings.templates.hmsTypes.${type}`;
}
