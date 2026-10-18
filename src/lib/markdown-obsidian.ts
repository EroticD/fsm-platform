import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import type { Blockquote, Parent, PhrasingContent, Root, RootContent } from "mdast";

/**
 * Obsidian-spesifikk syntaks på toppen av vanlig Markdown.
 *
 * Syntaksen følger Obsidian sin egen dokumentasjon
 * (https://obsidian.md/help/syntax):
 *
 *   ==uthevet==            utheving (mark)
 *   %%kommentar%%          kommentar – vises ikke i ferdig tekst
 *   [[Wikilenke]]          lenke – her peker den på søket i appen
 *   #tagg                  tagg – lenke til søket
 *   > [!tips] Tittel       callout (varselboks)
 *   ^[fotnote]             fotnote skrevet rett i teksten
 *
 * Kommentarer og fotnoter gjøres om i selve teksten før den parses, fordi de
 * endrer hvilken tekst som finnes. Resten gjøres på treet etterpå.
 *
 * All tekst som skal vises må gjennom `prepareObsidianSource()` før den
 * parses (se src/lib/markdown.ts, som er inngangen begge steder).
 */

/** Callout-typer: hvilket ikon og hvilken tittel boksen får. */
export const CALLOUT_TYPES: Record<string, { emoji: string; label: string }> = {
  note: { emoji: "📘", label: "Merknad" },
  info: { emoji: "ℹ️", label: "Info" },
  tip: { emoji: "🔥", label: "Tips" },
  success: { emoji: "✅", label: "Vellykket" },
  question: { emoji: "❓", label: "Spørsmål" },
  warning: { emoji: "⚠️", label: "Advarsel" },
  failure: { emoji: "❌", label: "Feil" },
  danger: { emoji: "⚡", label: "Fare" },
  bug: { emoji: "🐛", label: "Feil" },
  example: { emoji: "📋", label: "Eksempel" },
  quote: { emoji: "❝", label: "Sitat" },
  abstract: { emoji: "📄", label: "Sammendrag" },
  todo: { emoji: "☑️", label: "Oppgave" },
};

/** Obsidian godtar flere skrivemåter for samme type. */
const CALLOUT_ALIASES: Record<string, string> = {
  hint: "tip",
  tips: "tip",
  important: "tip",
  caution: "warning",
  attention: "warning",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
  summary: "abstract",
  tldr: "abstract",
};

export const calloutType = (raw: string): string => {
  const type = raw.toLowerCase();
  return CALLOUT_ALIASES[type] ?? type;
};

export const calloutMeta = (raw: string) => {
  const type = calloutType(raw);
  return { type, ...(CALLOUT_TYPES[type] ?? CALLOUT_TYPES.note) };
};

/* -------------------------------------------------------------------------- */
/* Før parsing: kommentarer og fotnoter skrevet rett i teksten                */
/* -------------------------------------------------------------------------- */

/** Er linjen starten på (eller slutten på) et kodegjerde? */
const fenceAt = (line: string) => line.match(/^\s{0,3}(`{3,}|~{3,})/);

/**
 * Kjører `fn` på delene av linjen som *ikke* er kode, slik at `` `%%` `` i en
 * kodesnutt får stå i fred.
 */
function mapOutsideCode(line: string, fn: (segment: string) => { text: string; open: boolean }): string {
  let result = "";
  let open = false;
  let index = 0;

  while (index < line.length) {
    const tick = line.indexOf("`", index);
    const stop = tick === -1 ? line.length : tick;
    const part = fn(line.slice(index, stop));
    result += part.text;
    open = open || part.open;
    if (tick === -1) break;

    let run = 0;
    while (line[tick + run] === "`") run += 1;
    const fence = "`".repeat(run);
    const end = line.indexOf(fence, tick + run);
    if (end === -1) {
      result += line.slice(tick);
      break;
    }
    result += line.slice(tick, end + run);
    index = end + run;
  }

  return open ? `${result}` : result;
}

/** Fjerner `%%…%%` i én tekstdel. Sier fra om en kommentar fortsetter videre. */
function stripInlineComments(segment: string): { text: string; open: boolean } {
  let kept = "";
  let rest = segment;
  for (;;) {
    const start = rest.indexOf("%%");
    if (start === -1) {
      kept += rest;
      return { text: kept, open: false };
    }
    kept += rest.slice(0, start);
    const end = rest.indexOf("%%", start + 2);
    if (end === -1) return { text: kept, open: true };
    rest = rest.slice(end + 2);
  }
}

/**
 * Fjerner `%%kommentarer%%`, både midt i en linje og over flere linjer.
 * Kodeblokker og kodesnutter røres ikke.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let fenceMark = "";
  let inComment = false;

  for (const line of source.split("\n")) {
    const fence = fenceAt(line);
    if (fence) {
      if (!fenceMark) fenceMark = fence[1][0];
      else if (fence[1][0] === fenceMark) fenceMark = "";
      out.push(line);
      continue;
    }
    if (fenceMark) {
      out.push(line);
      continue;
    }

    if (inComment) {
      const end = line.indexOf("%%");
      if (end === -1) continue;
      inComment = false;
      out.push(line.slice(end + 2));
      continue;
    }

    let opened = false;
    const cleaned = mapOutsideCode(line, (segment) => {
      const result = stripInlineComments(segment);
      opened = opened || result.open;
      return result;
    });
    inComment = opened;
    out.push(cleaned);
  }

  return out.join("\n");
}

/**
 * Gjør `^[dette er en fotnote]` om til en vanlig fotnote (`[^1]`) med
 * definisjonene samlet nederst. Obsidian har denne snarveien, Markdown har den
 * ikke.
 */
export function liftInlineFootnotes(source: string): string {
  const out: string[] = [];
  const definitions: string[] = [];
  let fenceMark = "";
  let count = 0;

  for (const line of source.split("\n")) {
    const fence = fenceAt(line);
    if (fence) {
      if (!fenceMark) fenceMark = fence[1][0];
      else if (fence[1][0] === fenceMark) fenceMark = "";
      out.push(line);
      continue;
    }
    if (fenceMark) {
      out.push(line);
      continue;
    }

    out.push(
      mapOutsideCode(line, (segment) => ({
        text: segment.replace(/\^\[([^\]]+)\]/g, (_match, text: string) => {
          count += 1;
          const id = `obsidian-${count}`;
          definitions.push(`[^${id}]: ${text}`);
          return `[^${id}]`;
        }),
        open: false,
      })),
    );
  }

  if (definitions.length > 0) out.push("", ...definitions);
  return out.join("\n");
}

/** Gjør teksten klar for Markdown-parseren (kommentarer bort, fotnoter samlet). */
export function prepareObsidianSource(source: string): string {
  return liftInlineFootnotes(stripComments(source));
}

/* -------------------------------------------------------------------------- */
/* Etter parsing: utheving, lenker, tagger og callouts                        */
/* -------------------------------------------------------------------------- */

/** Deler en tekststreng i vanlig Markdown, så utheving kan inneholde fet/kursiv. */
function parseInlineText(value: string): PhrasingContent[] {
  const tree = fromMarkdown(value);
  const paragraph = tree.children[0];
  if (paragraph?.type === "paragraph") return paragraph.children as PhrasingContent[];
  return [{ type: "text", value }];
}

type CustomNode = RootContent & { data?: Record<string, unknown> };

const withHast = (
  type: string,
  hName: string,
  hProperties: Record<string, unknown>,
  children: RootContent[],
): CustomNode =>
  ({
    type,
    data: { hName, hProperties },
    children,
  }) as unknown as CustomNode;

/** Bytter ut alle barn i treet med resultatet av `fn`, rekursivt. */
function transformChildren(parent: Parent, fn: (child: RootContent) => RootContent[]) {
  const next: RootContent[] = [];
  for (const child of parent.children as RootContent[]) {
    if ("children" in child && Array.isArray((child as Parent).children)) {
      transformChildren(child as Parent, fn);
    }
    next.push(...fn(child));
  }
  parent.children = next;
}

/** `==uthevet tekst==` blir <mark>. */
function transformHighlights(tree: Root) {
  transformChildren(tree, (child) => {
    if (child.type !== "text" || !child.value.includes("==")) return [child];

    const parts = child.value.split(/(==[^=]+==)/g).filter(Boolean);
    if (parts.length === 1) return [child];

    return parts.map((part) =>
      part.startsWith("==") && part.endsWith("==") && part.length > 4
        ? withHast("obsidianHighlight", "mark", {}, parseInlineText(part.slice(2, -2)))
        : ({ type: "text", value: part } as RootContent),
    );
  });
}

/** `[[Wikilenke]]`, `[[mål|tekst]]` og `![[innbygging]]` blir lenker til søket. */
function transformWikiLinks(tree: Root) {
  const pattern = /!?\[\[([^\][|]+)(?:\|([^\]]+))?\]\]/g;

  transformChildren(tree, (child) => {
    if (child.type !== "text" || !child.value.includes("[[")) return [child];

    const matches = [...child.value.matchAll(pattern)];
    if (matches.length === 0) return [child];

    const parts: RootContent[] = [];
    let cursor = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      if (start > cursor) parts.push({ type: "text", value: child.value.slice(cursor, start) });
      const target = match[1].trim();
      const label = (match[2] ?? match[1]).trim();
      parts.push({
        type: "link",
        url: `/sok?q=${encodeURIComponent(target)}`,
        title: `Slå opp «${target}»`,
        children: [{ type: "text", value: match[0].startsWith("!") ? `🖼 ${label}` : label }],
      } as RootContent);
      cursor = start + match[0].length;
    }
    if (cursor < child.value.length) parts.push({ type: "text", value: child.value.slice(cursor) });
    return parts;
  });
}

/**
 * `#tagg` blir en lenke til søket. En tagg må inneholde minst ett tegn som
 * ikke er siffer, ellers ville «#123» blitt en tagg.
 */
function transformTags(tree: Root) {
  const pattern = /(^|\s)(#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

  transformChildren(tree, (child) => {
    if (child.type !== "text" || !child.value.includes("#")) return [child];

    const matches = [...child.value.matchAll(pattern)];
    if (matches.length === 0) return [child];

    const parts: RootContent[] = [];
    let cursor = 0;
    for (const match of matches) {
      const start = (match.index ?? 0) + match[1].length;
      if (start > cursor) parts.push({ type: "text", value: child.value.slice(cursor, start) });
      const tag = match[2].slice(1);
      parts.push({
        type: "link",
        url: `/sok?q=${encodeURIComponent(tag)}`,
        title: `Finn alt merket «${tag}»`,
        children: [{ type: "text", value: match[2] }],
      } as RootContent);
      cursor = start + match[2].length;
    }
    if (cursor < child.value.length) parts.push({ type: "text", value: child.value.slice(cursor) });
    return parts;
  });
}

// Merk: uten `s`-flagget (krever ES2018) – `[\s\S]` matcher det samme.
const CALLOUT_MARKER = /^\[!([\p{L}\p{N}_-]+)\]([+-]?)[ \t]*([\s\S]*)$/u;

/** `> [!tips] Tittel` blir en varselboks med ikon og farge. */
function transformCallouts(tree: Root) {
  visit(tree, "blockquote", (node: Blockquote, index, parent) => {
    if (index === undefined || !parent) return;

    const first = node.children[0];
    if (first?.type !== "paragraph") return;
    const firstText = first.children[0];
    if (firstText?.type !== "text") return;

    const marker = firstText.value.match(CALLOUT_MARKER);
    if (!marker) return;

    const meta = calloutMeta(marker[1]);
    const title = marker[3].trim() || meta.label;

    // Fjern marker-linjen fra det første avsnittet, og dropp avsnittet om det
    // ikke står noe igjen.
    const rest = firstText.value.slice(marker[0].length).replace(/^\n/, "");
    if (rest.length > 0) firstText.value = rest;
    else first.children.shift();
    // Linjeskiftet rett etter markøren blir stående igjen som en tom linje.
    if (first.children[0]?.type === "break") first.children.shift();
    if (first.children.length === 0) node.children.shift();

    const callout = withHast(
      "obsidianCallout",
      "div",
      { className: ["callout", `callout-${meta.type}`] },
      [
        withHast(
          "obsidianCalloutTitle",
          "div",
          // Typen står også på tittelen, slik at viseren kan fargelegge den riktig.
          { className: ["callout-title", `callout-${meta.type}`] },
          [{ type: "text", value: `${meta.emoji} ${title}` }],
        ),
        ...(node.children as unknown as RootContent[]),
      ],
    );

    parent.children[index] = callout as never;
  });
}

/**
 * remark-plugin: Obsidian-spesifikk syntaks. Brukes både når teksten vises på
 * nettsiden og når rapporten skal bli PDF. Kalles av `remarkPlugins` i
 * react-markdown og av `markdownToMdast()` – begge steder etter at teksten har
 * vært gjennom `prepareObsidianSource()`.
 */
export function remarkObsidian() {
  return (tree: Root) => {
    transformHighlights(tree);
    transformWikiLinks(tree);
    transformTags(tree);
    transformCallouts(tree);
  };
}
