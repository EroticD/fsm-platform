const JSON_KEY = /"[A-Za-z0-9_$-]{1,40}"\s*:\s*/g;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeJson(value: string): boolean {
  return (
    /^\s*[{[]/.test(value) ||
    /"[^"\n]{1,40}"\s*:/.test(value) ||
    /\\"/.test(value)
  );
}

/**
 * Gjør et søkeutdrag fra PostgreSQL lesbart.
 *
 * Rapportsøket bygger utdraget fra `answersJson`, så et treff kan begynne
 * midt i et JSON-objekt (`"value": "Pumpe byttet", "comment": null`). Vi
 * fjerner nøkler, klammeparenteser og escape-tegn, men lar vanlig tekst stå.
 */
export function cleanSearchSnippet(value: string | null | undefined): string {
  if (!value) return "";

  let text = value.replace(/<\/?b>/gi, "").trim();
  if (!looksLikeJson(text)) return collapseWhitespace(text);

  text = text
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\[nrt]/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(JSON_KEY, " ")
    .replace(/[{}\[\]]/g, " ")
    .replace(/"/g, " ")
    .replace(/,/g, " ")
    .replace(/\b(?:null|true|false)\b/g, " ");

  return collapseWhitespace(text);
}
