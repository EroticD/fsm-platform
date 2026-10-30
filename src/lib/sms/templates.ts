/**
 * Hendelsesmaler for SMS.
 *
 * Variabellisten er en eksplisitt hviteliste. En mal kan bare bruke disse
 * plassholderne, og tjenestelaget fyller bare inn verdier fra samme liste.
 * Da kan en redaktør ikke smugle inn vilkårlige data i en utgående melding.
 */

export const SMS_EVENT_KEYS = [
  "BOOKING_CONFIRMED",
  "VISIT_REMINDER",
  "ON_MY_WAY",
  "VISIT_DONE",
  "REVIEW_REQUEST",
] as const;

export type SmsEventKey = (typeof SMS_EVENT_KEYS)[number];

export const SMS_TEMPLATE_VARIABLES = [
  "contactName",
  "customerName",
  "companyName",
  "workOrderTitle",
  "date",
  "time",
  "reference",
  "technicianName",
  "trackingUrl",
  "reviewUrl",
] as const;

export type SmsTemplateVariable = (typeof SMS_TEMPLATE_VARIABLES)[number];
export type SmsTemplateValues = Partial<Record<SmsTemplateVariable, unknown>>;

export const SMS_MAX_BODY_LENGTH = 1600;
export const SMS_LOCALES = ["nb", "en", "pl", "de"] as const;
export const SMS_DEFAULT_LOCALE = "nb";

export type SmsLocale = (typeof SMS_LOCALES)[number];

export function isSmsEventKey(value: unknown): value is SmsEventKey {
  return (
    typeof value === "string" &&
    (SMS_EVENT_KEYS as readonly string[]).includes(value)
  );
}

export function isSmsTemplateVariable(
  value: unknown,
): value is SmsTemplateVariable {
  return (
    typeof value === "string" &&
    (SMS_TEMPLATE_VARIABLES as readonly string[]).includes(value)
  );
}

/** Ukjent eller tom locale faller tilbake til norsk. */
export function smsLocale(value: unknown, fallback = SMS_DEFAULT_LOCALE): SmsLocale {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (SMS_LOCALES as readonly string[]).includes(candidate)
    ? (candidate as SmsLocale)
    : (fallback as SmsLocale);
}

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** Alle plassholdere i en maltekst, uten duplikater og i leserekkefølge. */
export function extractSmsTemplateVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) found.add(match[1]);
  return [...found];
}

export type SmsTemplateValidation =
  | { ok: true; variables: string[] }
  | { ok: false; reason: "empty" | "too_long" | "unknown_variable"; unknown: string[] };

/**
 * Validerer en maltekst. Både ukjente plassholdere og en for lang tekst
 * avvises; tom tekst er ikke en gyldig mal.
 */
export function validateSmsTemplateBody(body: unknown): SmsTemplateValidation {
  if (typeof body !== "string") {
    return { ok: false, reason: "empty", unknown: [] };
  }
  const text = body.trim();
  if (!text) return { ok: false, reason: "empty", unknown: [] };
  if (text.length > SMS_MAX_BODY_LENGTH) {
    return { ok: false, reason: "too_long", unknown: [] };
  }

  const variables = extractSmsTemplateVariables(text);
  const unknown = variables.filter((name) => !isSmsTemplateVariable(name));
  if (unknown.length > 0) {
    return { ok: false, reason: "unknown_variable", unknown };
  }
  return { ok: true, variables };
}

/** Filtrerer en lagret variabelliste ned til den globale hvitelisten. */
export function sanitizeSmsTemplateVariables(value: unknown): SmsTemplateVariable[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isSmsTemplateVariable))];
}

/**
 * Fyller inn kjente verdier. En tillatt, men manglende verdi blir tom – en
 * valgfri lenke skal ikke stoppe en ellers gyldig melding.
 */
export function renderSmsTemplate(
  body: string,
  values: SmsTemplateValues,
): string {
  return body
    .replace(PLACEHOLDER, (_match, name: string) => {
      if (!isSmsTemplateVariable(name)) return "";
      const value = values[name];
      if (value === null || value === undefined) return "";
      return String(value);
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Normaliserer et nøkkelord for sammenligning med STOP/START-varianter. */
export function normalizeSmsKeyword(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toUpperCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

export type SmsConsentAction = "OPT_OUT" | "OPT_IN" | null;

/**
 * Gjenkjenner reservering eller nytt samtykke. Listen kommer fra
 * `SmsSetting`, slik at kontoret kan legge til lokale varianter.
 */
export function smsConsentAction(
  body: unknown,
  optOutKeywords: readonly string[],
  optInKeywords: readonly string[],
): SmsConsentAction {
  const keyword = normalizeSmsKeyword(body);
  if (!keyword) return null;
  const optOut = optOutKeywords.map(normalizeSmsKeyword).filter(Boolean);
  const optIn = optInKeywords.map(normalizeSmsKeyword).filter(Boolean);
  if (optOut.includes(keyword)) return "OPT_OUT";
  if (optIn.includes(keyword)) return "OPT_IN";
  return null;
}
