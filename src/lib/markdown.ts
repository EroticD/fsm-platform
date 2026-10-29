import type { Root } from "mdast";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { defaultSchema } from "rehype-sanitize";
import { unified } from "unified";
import { prepareObsidianSource, remarkObsidian } from "./markdown-obsidian";

/**
 * Felles Markdown-oppsett for hele appen.
 *
 * Samme oppsett brukes tre steder:
 *   1. `MarkdownView` – viser teksten på nettsiden (react-markdown).
 *   2. `renderMarkdownPdf` – tegner teksten i servicerapporten (react-pdf).
 *   3. `markdownToPlainText` – korte sammendrag i lister, søk og e-post.
 *
 * Grunnsyntaksen er CommonMark + GFM (tabeller, oppgavelister, gjennomstreking,
 * fotnoter) pluss Obsidian-syntaksen i markdown-obsidian.ts. Enkelt linjeskift
 * blir linjeskift også i ferdig tekst (`remark-breaks`), slik at tekst som ble
 * skrevet før Markdown ble innført ser lik ut som før.
 */

/** Rekkefølgen er viktig: Obsidian-syntaksen går ut fra ferdig parset GFM. */
export const remarkPlugins = [remarkGfm, remarkBreaks, remarkObsidian];

/**
 * URL-policy for Markdown-lenker.
 *
 * Nettsiden går gjennom rehype-sanitize, men PDF-en gjør det ikke: react-pdf
 * skriver lenken rett inn i dokumentet. En `javascript:`, `data:` eller
 * `file:`-lenke ville da blitt en aktiv handling i en signert rapport. Vi
 * slipper derfor bare gjennom vanlige nettsider, e-post, telefon og anker.
 *
 * Relative stier og andre protokoller avvises. Funksjonen returnerer den
 * kanoniske URL-en, eller `null` når lenken skal tegnes som ren tekst.
 */
const SAFE_MARKDOWN_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function safeMarkdownUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("#")) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (!SAFE_MARKDOWN_PROTOCOLS.has(url.protocol.toLowerCase())) return null;
  // Innloggingsinfo i en lenke skjuler den egentlige verten for leseren.
  if (url.username || url.password) return null;

  return url.href;
}

/**
 * Klassene vi selv legger på (callouts) – og de remark-gfm legger på
 * oppgavelister. Alt annet av klasser og stiler blir strippet.
 */
const ALLOWED_CLASS = /^(callout(-[a-z]+)?|callout-title|task-list-item|contains-task-list|language-[\w.+-]+)$/;

/**
 * Hvilket HTML vi tillater etter at Markdown er gjort om til HTML. Vi legger
 * ikke selv inn rå HTML, så dette er et sikkerhetsnett: det hindrer at en
 * `javascript:`-lenke eller en påklistret klasse slipper gjennom.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    mark: [["className", ALLOWED_CLASS]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", ALLOWED_CLASS]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", ALLOWED_CLASS]],
    li: [...(defaultSchema.attributes?.li ?? []), ["className", ALLOWED_CLASS]],
    ul: [...(defaultSchema.attributes?.ul ?? []), ["className", ALLOWED_CLASS]],
    code: [["className", ALLOWED_CLASS]],
    a: [...(defaultSchema.attributes?.a ?? []), "title"],
    // Avkrysningsbokser i oppgavelister: om de er krysset av, er en egenskap
    // remark-gfm setter, og som standard skjemaet kaster.
    input: [["disabled", true], ["type", "checkbox"], "checked"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "tel"],
  },
};

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkBreaks).use(remarkObsidian);

/** Gjør om Markdown (med Obsidian-syntaks) til et mdast-tre. */
export function markdownToMdast(source: string): Root {
  const prepared = prepareObsidianSource(source);
  return processor.runSync(processor.parse(prepared)) as Root;
}

/**
 * Reglene for å gjøre Markdown om til ren tekst. Rekkefølgen har noe å si:
 * kode og kommentarer først, så hele blokker, så innebygd formatering.
 */
const PLAIN_TEXT_RULES: Array<(text: string) => string> = [
  // Gammel tekst kan inneholde HTML fra før rensingen kom på plass.
  (text) =>
    text
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<\/?[a-zA-Z][^>]*>/g, " "),
  (text) => text.replace(/```[\s\S]*?```/g, " "),
  (text) => text.replace(/%%[\s\S]*?%%/g, " "),
  (text) => text.replace(/^ {0,3}>\s?\[![^\]]+\][+-]?[ \t]*/gm, ""),
  (text) => text.replace(/^ {0,3}>\s?/gm, ""),
  (text) => text.replace(/^ {0,3}#{1,6}\s*/gm, ""),
  (text) => text.replace(/^ {0,3}[-*+] \[[ xX]\]\s+/gm, ""),
  (text) => text.replace(/^ {0,3}(?:[-*+]|\d+[.)])\s+/gm, ""),
  (text) => text.replace(/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/gm, " "),
  (text) => text.replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, " "),
  (text) => text.replace(/^\s*\[\^[^\]]+\]:.*$/gm, ""),
  (text) =>
    text.replace(/!?\[\[([^\][|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias || target),
  (text) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"),
  (text) => text.replace(/\[\^[^\]]+\]/g, ""),
  (text) => text.replace(/\^\[([^\]]+)\]/g, "$1"),
  (text) => text.replace(/\\?([*_~`=])/g, ""),
  (text) => text.replace(/\|/g, " "),
];

/**
 * Markdown til ren tekst, for lister, søketreff og e-post. Dette er en rask
 * forenkling – den plukker bort formateringstegn, men den er ikke en parser.
 */
export function markdownToPlainText(source: string | null | undefined): string {
  if (!source) return "";
  let text = source;
  for (const rule of PLAIN_TEXT_RULES) text = rule(text);
  return text.replace(/\s+/g, " ").trim();
}
