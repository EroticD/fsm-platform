/**
 * Rensing av tekst før den lagres.
 *
 * Alt som kommer fra et skjema er tekst noen har skrevet, og kan inneholde
 * HTML, kontrolltegn eller være enormt. Feltene som er Markdown får beholde
 * linjeskift og Markdown-tegn (`cleanMarkdown`), mens de øvrige feltene er
 * enkle tekstfelt (`cleanText`).
 *
 * Dette er første forsvarslinje. Den andre er at Markdown-viseren aldri tolker
 * HTML (se src/components/MarkdownView.tsx), og at e-postmaler bygger HTML med
 * `escapeHtml`.
 */

/** Lengdegrensene vi bruker, så feltene ikke kan fylles med vilkårlig mye tekst. */
export const LIMITS = {
  /** Navn på ting: enheter, roller, steder. */
  short: 120,
  /** Titler på oppdrag, kunder og maler. */
  title: 200,
  /** Adresser, telefonnumre, e-post, serienumre. */
  line: 500,
  /** Notater og kommentarer skrevet som ren tekst. */
  text: 2000,
  /** Beskrivelser og rapportnotater, som kan inneholde Markdown. */
  markdown: 20000,
} as const;

/** HTML-tagger, men ikke «a < b»: det må være en bokstav etter < eller </. */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/** Skript og stiler fjernes med innhold – resten av koden er bare søppel. */
const HTML_BLOCK = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Kontrolltegn utenom tab, linjeskift og vognretur – og retningsstyring. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

const asString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

/** Fjerner HTML og kontrolltegn. Beholder linjeskift hvis `multiline`. */
function strip(value: unknown, multiline: boolean): string {
  const text = asString(value)
    .replace(HTML_COMMENT, "")
    .replace(HTML_BLOCK, "")
    .replace(HTML_TAG, "")
    .replace(CONTROL_CHARS, "");
  const normalized = text.replace(/\r\n?/g, "\n");
  return multiline ? normalized : normalized.replace(/\s+/g, " ");
}

const cut = (value: string, maxLength: number) => (value.length > maxLength ? value.slice(0, maxLength).trim() : value);

/**
 * Ren tekst: HTML og kontrolltegn fjernes, og alt avsluttes med `trim`.
 * Standard er én linje – sett `multiline: true` for felt med linjeskift.
 */
export function cleanText(
  value: unknown,
  options: { maxLength?: number; multiline?: boolean } = {},
): string {
  const maxLength = options.maxLength ?? LIMITS.text;
  return cut(strip(value, options.multiline ?? false).trim(), maxLength);
}

/**
 * Markdown: beholder linjeskift og formatering, men fjerner rå HTML – viseren
 * tolker ikke HTML uansett, og da er det greiere å ikke lagre den.
 */
export function cleanMarkdown(value: unknown, options: { maxLength?: number } = {}): string {
  const maxLength = options.maxLength ?? LIMITS.markdown;
  return cut(
    strip(value, true)
      // Unødvendig mange tomme linjer gjør rapporten uleselig.
      .replace(/\n{4,}/g, "\n\n\n")
      .trim(),
    maxLength,
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** E-post: små bokstaver, uten mellomrom. Ugyldig adresse blir tom tekst. */
export function cleanEmail(value: unknown): string {
  const email = strip(value, false).trim().toLowerCase().replace(/\s/g, "");
  if (email.length === 0) return "";
  return EMAIL.test(email) ? cut(email, 254) : "";
}

/** Telefonnummer: beholder sifre og vanlige skilletegn. */
export function cleanPhone(value: unknown): string {
  const phone = strip(value, false)
    .replace(/[^\d+\s().-]/g, "")
    .trim();
  return cut(phone, 40);
}

/**
 * Lenke: bare http(s) eller en sti i appen. Alt annet (som `javascript:`)
 * blir tom tekst.
 */
export function cleanUrl(value: unknown): string {
  const url = strip(value, false).trim();
  if (url.length === 0) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return cut(url, LIMITS.line);
  return "";
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Fargekode for kundens profil (`brandColor`, `primaryColor`). Ugyldig verdi
 * blir tom, og kalleren bruker da standardfargen.
 */
export function cleanColor(value: unknown, fallback = ""): string {
  const color = strip(value, false).trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : fallback;
}

/** Rollene appen kjenner. Alt annet blir avvist. */
export const ROLES = ["ADMIN", "OFFICE", "TECHNICIAN", "CUSTOMER"] as const;

/** Rollekode fra et skjema. Ukjent rolle blir tom tekst. */
export function cleanRole(value: unknown): string {
  const role = strip(value, false).trim().toUpperCase();
  return (ROLES as readonly string[]).includes(role) ? role : "";
}

/** Statusene et oppdrag kan ha (samme som WorkStatus i schema.prisma). */
export const WORK_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "PENDING",
  "CANCELLED",
  "OPEN",
] as const;

/** Oppdragsstatus fra et skjema. Ukjent status blir tom tekst. */
export function cleanStatus(value: unknown): (typeof WORK_STATUSES)[number] | "" {
  const status = strip(value, false).trim().toUpperCase();
  return (WORK_STATUSES as readonly string[]).includes(status)
    ? (status as (typeof WORK_STATUSES)[number])
    : "";
}

/** Sikker visning av tekst i HTML vi bygger selv (e-postmaler). */
export function escapeHtml(value: unknown): string {
  return asString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z\d+/=\s]+$/i;
/**
 * Signaturer tegnes på skjermen og lagres som et bilde i teksten
 * (`data:image/png;base64,…`). Her godtar vi bare ekte bildedata, og bare opp
 * til en størrelse som er rimelig for en underskrift.
 */
export function cleanDataImage(value: unknown, maxLength = 3_000_000): string {
  const url = asString(value).trim();
  if (url.length === 0 || url.length > maxLength) return "";
  return DATA_IMAGE.test(url) ? url : "";
}
