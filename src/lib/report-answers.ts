/**
 * Hjelpere for å lese svarverdier fra en rapport.
 *
 * Svar lagres som tekst i `answersJson`. Bilde-svar har endret format underveis:
 * eldre rapporter har én URL som ren tekst, mens nye rapporter lagrer en
 * JSON-liste med URL-er (fordi man kan laste opp flere bilder per sjekkpunkt).
 * Disse hjelperne godtar begge formatene.
 */

/** Godtar enkelt-URL ("/uploads/x.jpg") eller JSON-liste ("[\"/uploads/a.jpg\"]"). */
export function parseImageUrls(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const raw = value.trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((url): url is string => typeof url === "string")
        .map((url) => url.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  return [raw];
}

/** Leser et JSON-objekt trygt, og gir alltid et objekt tilbake. */
export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
}

/** Rapportens samlede resultat når den har enheter. */
export const REPORT_STATUS_APPROVED = "GODKJENT";
export const REPORT_STATUS_DEVIATION = "AVVIK";

/**
 * Rapport uten enheter. En slik rapport har ingen enhet å godkjenne eller
 * registrere avvik på, og skal derfor verken vises som godkjent eller avvik.
 * Den anonyme raden som bærer svarfeltene lagrer denne verdien i `status`.
 */
export const REPORT_STATUS_WITHOUT_UNITS = "UTEN_ENHET";

/**
 * "GODKJENT" | "AVVIK" | "UTEN_ENHET" | "UKJENT" ut fra rapportens dataJson.
 * Eldre rapporter uten enheter kan ha GODKJENT/AVVIK; visningen må bruke
 * rapportens `requiresUnits` i stedet for å stole på den lagrede verdien.
 */
export function reportStatus(dataJson: string | null | undefined): string {
  const parsed = parseJsonObject(dataJson);
  const status = parsed.status;
  return typeof status === "string" && status ? status : "UKJENT";
}

/* ------------------------------------------------------------------ *
 * Tilstandsvurdering: et felt med flere valg (OK / Avvik / Utbedres …)
 * der enkelte valg krever en kommentar på den samme linjen.
 * ------------------------------------------------------------------ */

/** Standardvalgene for et tilstandsfelt. */
export const STATUS_DEFAULT_OPTIONS = ["OK", "Avvik", "Utbedres", "Ikke aktuelt"];

/** Valgene som krever kommentar hvis ikke malen sier noe annet. */
export const STATUS_DEFAULT_COMMENT_OPTIONS = ["Avvik", "Utbedres"];

export type ChoiceFieldDef = {
  id: string;
  type?: string;
  label?: string;
  options?: string[];
  commentOptions?: string[];
};

/** Valgene i feltet – faller tilbake på standardvalgene for tilstandsfelt. */
export function fieldOptions(field: ChoiceFieldDef): string[] {
  return field.options && field.options.length > 0 ? field.options : STATUS_DEFAULT_OPTIONS;
}

/** Valgene som krever at montøren skriver en kommentar. */
export function commentTriggerOptions(field: ChoiceFieldDef): string[] {
  return Array.isArray(field.commentOptions)
    ? field.commentOptions
    : STATUS_DEFAULT_COMMENT_OPTIONS;
}

/** Krever dette svaret en kommentar på linjen? */
export function needsComment(field: ChoiceFieldDef, value: unknown): boolean {
  return typeof value === "string" && commentTriggerOptions(field).includes(value);
}

/** Nøkkelen kommentaren til en linje lagres under (i samme svarobjekt). */
export function lineCommentKey(fieldId: string): string {
  return `${fieldId}__kommentar`;
}

/** Leser kommentaren som hører til én linje. */
export function readLineComment(answers: Record<string, unknown>, fieldId: string): string {
  const value = answers[lineCommentKey(fieldId)];
  return typeof value === "string" ? value.trim() : "";
}

/** Svar som er kommentarer til en linje skal ikke vises som egne sjekkpunkter. */
export function isLineCommentKey(key: string): boolean {
  return key.endsWith("__kommentar");
}

