import { LIMITS, cleanText } from "./sanitize";

/**
 * Sjekklistemalene lagres som en JSON-liste med felt i `Template.fieldsJson`.
 * Den kommer fra en klient-komponent (TemplateBuilder) og må derfor vaskes før
 * den havner i databasen – ellers kunne hvem som helst legge inn hva som helst
 * i en mal som vises for alle montører.
 *
 * Samme fasong brukes i rapportsvarene (se lib/report-answers.ts), så feltene
 * beholdes som de er – vi bare renser innholdet og forkaster det vi ikke kjenner.
 */

/** Felttypene appen kjenner. */
const FIELD_TYPES = new Set([
  "TEXT",
  "TEXTAREA",
  "CHECKBOX",
  "SELECT",
  "STATUS",
  "NUMBER",
  "SIGNATURE",
  "IMAGE",
  "DATE",
]);

/** Id-er genereres i klienten og brukes som nøkkel i svar-JSON. */
const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type CleanedTemplateField = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[];
  commentOptions?: string[];
};

const cleanList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .map((item) => cleanText(item, { maxLength: LIMITS.title }))
    .filter((item) => item.length > 0)
    .slice(0, 50);
  return list.length > 0 ? list : undefined;
};

/** Renser ett felt. Returnerer `null` for noe vi ikke kan bruke. */
export function cleanTemplateField(raw: unknown): CleanedTemplateField | null {
  if (!raw || typeof raw !== "object") return null;
  const field = raw as Record<string, unknown>;

  const type = String(field.type ?? "").toUpperCase();
  if (!FIELD_TYPES.has(type)) return null;

  // Felt uten id får en fra posisjonen sin – men da er svarene på en gammel
  // rapport ikke lenger knyttet til rett felt, så feltet må ha en id.
  const id = typeof field.id === "string" && FIELD_ID.test(field.id) ? field.id : null;
  if (!id) return null;

  const label = cleanText(field.label, { maxLength: LIMITS.title });

  return {
    id,
    type,
    label,
    required: field.required === true,
    options: cleanList(field.options),
    commentOptions: type === "STATUS" ? cleanList(field.commentOptions) : undefined,
  };
}

/** Renser hele `fieldsJson`. Ugyldig JSON gir en tom liste. */
export function cleanTemplateFieldsJson(raw: unknown): string {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return "[]";
    }
  }
  if (!Array.isArray(parsed)) return "[]";

  const fields = parsed
    .map(cleanTemplateField)
    .filter((field): field is CleanedTemplateField => field !== null)
    .slice(0, 100);

  return JSON.stringify(fields);
}
