/**
 * Synlighet for betingede sjekklistefelt.
 *
 * Klienten (ReportForm) og serveren må bruke nøyaktig samme regel: et felt med
 * `conditionalFieldId` vises bare når kildefeltet har `conditionalValue`.
 * Serveren bruker denne modulen når den avgjør om et påkrevd felt faktisk
 * gjelder, slik at et skjult felt ikke blokkerer innsending.
 */
export type ConditionalField = {
  conditionalFieldId?: string;
  conditionalValue?: string;
};

/** Sammenligner et svar med malens betingelsesverdi, uten hensyn til case. */
export function answerMatchesCondition(
  value: unknown,
  expected: string | undefined,
): boolean {
  if (expected === undefined) return true;
  const raw = (value === undefined || value === null ? "" : String(value))
    .trim()
    .toLowerCase();
  const wanted = expected.trim().toLowerCase();
  if (raw === wanted) return true;
  // Avkrysningsfelt lagres som «true»/«false», men malbyggeren kan ha skrevet
  // «Ja»/«Nei» som betingelse. Godta begge skrivemåtene.
  const truthy = ["true", "ja", "yes", "1"];
  const falsy = ["false", "nei", "no", "0"];
  return (
    (truthy.includes(raw) && truthy.includes(wanted)) ||
    (falsy.includes(raw) && falsy.includes(wanted))
  );
}

/** Er feltet synlig ut fra svarene i samme enhet? */
export function isTemplateFieldVisible(
  field: ConditionalField,
  answers: Record<string, unknown>,
): boolean {
  if (!field.conditionalFieldId) return true;
  return answerMatchesCondition(
    answers[field.conditionalFieldId],
    field.conditionalValue,
  );
}
