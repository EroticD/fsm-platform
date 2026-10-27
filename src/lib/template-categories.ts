import type { HmsFormType, TemplateCategory } from "@prisma/client";

/**
 * Kategorisering av maler og rapporter.
 *
 * HMS-sjekklister er førsteklasses rapporter, men de skal være tydelig skilt fra
 * de vanlige service-sjekklistene i oppdrags- og rapportvisningene. Hjelperne
 * her er rene og feiler lukket: manglende eller ukjent kategori behandles som
 * SERVICE, slik at eldre rader uten kategori oppfører seg som før.
 */

type CategorizedTemplate = {
  category?: TemplateCategory | null;
};

type CategorizedReport = {
  templateCategory?: TemplateCategory | null;
};

/** Kategorien til en mal. Eldre/ukjente verdier regnes som service. */
export function templateCategoryOf(
  template: CategorizedTemplate | null | undefined,
): TemplateCategory {
  return template?.category === "HMS" ? "HMS" : "SERVICE";
}

/** Kategorien til en rapport, fra det frosne øyeblikksbildet. */
export function reportTemplateCategoryOf(
  report: CategorizedReport | null | undefined,
): TemplateCategory {
  return report?.templateCategory === "HMS" ? "HMS" : "SERVICE";
}

export function isHmsTemplate(
  template: CategorizedTemplate | null | undefined,
): boolean {
  return templateCategoryOf(template) === "HMS";
}

export function isHmsReport(
  report: CategorizedReport | null | undefined,
): boolean {
  return reportTemplateCategoryOf(report) === "HMS";
}

/** Deler en maltabell i service og HMS, uten å endre rekkefølgen innad. */
export function splitTemplatesByCategory<T extends CategorizedTemplate>(
  templates: readonly T[],
): { service: T[]; hms: T[] } {
  const service: T[] = [];
  const hms: T[] = [];
  for (const template of templates) {
    if (isHmsTemplate(template)) hms.push(template);
    else service.push(template);
  }
  return { service, hms };
}

/**
 * Norske visningsnavn for HMS-undertyper. Brukes i PDF-en, som er statisk
 * norsk, og som fallback der oversettelsesnøkkelen ikke finnes.
 */
export const HMS_TYPE_LABELS: Record<HmsFormType, string> = {
  GENERAL: "Generelt HMS-skjema",
  SJA: "Sikker jobb analyse (SJA)",
  HOT_WORK: "Varmt arbeid",
  INTERNAL_CONTROL: "Risikovurdering / internkontroll",
  DEVIATION: "Avviksmelding",
  SAFETY_ROUND: "Vernerunde",
  WRITTEN_INSTRUCTION: "Skriftlig instruks",
};

/** Oversettelsesnøkkel (under `orders`) for en HMS-undertype. */
export const HMS_TYPE_MESSAGE_KEYS: Record<HmsFormType, string> = {
  GENERAL: "orders.hmsTypes.general",
  SJA: "orders.hmsTypes.sja",
  HOT_WORK: "orders.hmsTypes.hotWork",
  INTERNAL_CONTROL: "orders.hmsTypes.internalControl",
  DEVIATION: "orders.hmsTypes.deviation",
  SAFETY_ROUND: "orders.hmsTypes.safetyRound",
  WRITTEN_INSTRUCTION: "orders.hmsTypes.writtenInstruction",
};

export function hmsTypeLabel(type: HmsFormType | null | undefined): string | null {
  return type ? HMS_TYPE_LABELS[type] ?? null : null;
}
