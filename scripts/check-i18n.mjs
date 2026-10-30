#!/usr/bin/env node
/**
 * Sjekker oversettelseskatalogene og hardkodede norske strenger.
 *
 *   node scripts/check-i18n.mjs            # paritet er streng, resten varsel
 *   node scripts/check-i18n.mjs --strict   # også hardkodet norsk og ubrukte nøkler feiler
 *
 * Paritet (samme nøkler i nb og en) feiler alltid med exit 1. Hardkodede
 * strenger og ubrukte nøkler rapporteres alltid, men gir bare exit 1 med
 * --strict, slik at CI kan kjøre den vanlige kommandoen uten å stoppe på
 * kjente, bevisste unntak.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");

function deepMerge(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = result[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readMessages(lang) {
  const base = JSON.parse(
    fs.readFileSync(path.join(root, `messages/${lang}.json`), "utf8"),
  );
  const fragmentsDir = path.join(root, "messages/fragments");
  let merged = base.common ?? {};
  for (const file of fs.readdirSync(fragmentsDir)) {
    if (!file.endsWith(`.${lang}.json`)) continue;
    const fragment = JSON.parse(
      fs.readFileSync(path.join(fragmentsDir, file), "utf8"),
    );
    merged = deepMerge(merged, fragment);
  }
  return merged;
}

function flatten(value, prefix = "", out = []) {
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const CHECKED_LOCALES = ["nb", "en", "pl", "de"];
const referenceLocale = "nb";
const nbKeys = new Set(flatten(readMessages(referenceLocale)));

let failed = false;
for (const locale of CHECKED_LOCALES) {
  if (locale === referenceLocale) continue;
  let keys;
  try {
    keys = new Set(flatten(readMessages(locale)));
  } catch (error) {
    failed = true;
    console.error(`✖ i18n: kunne ikke lese ${locale}: ${error.message}`);
    continue;
  }
  const missing = [...nbKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !nbKeys.has(key));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`✖ i18n: nøklene stemmer ikke for ${locale}`);
    if (missing.length) console.error(`  Mangler i ${locale}:`, missing.join(", "));
    if (extra.length) console.error(`  Ekstra i ${locale}:`, extra.join(", "));
  }
}
if (!failed) {
  console.log(
    `✓ i18n: ${nbKeys.size} nøkler i alle språk (${CHECKED_LOCALES.join(", ")})`,
  );
}

function walk(directory, extensions, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, extensions, out);
    else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

/** Fjerner kommentarer slik at norske kodetekster ikke telles som UI-tekst. */
function stripComments(source) {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        const current = source[index];
        out += current;
        if (current === "\\") {
          out += source[index + 1] ?? "";
          index += 2;
          continue;
        }
        index += 1;
        if (current === quote) break;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      out += "  ";
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < source.length) {
        out += "  ";
        index += 2;
      }
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

const STRING_LITERAL = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;
const NORWEGIAN_WORDS =
  /\b(og|ikke|ingen|uten|oppdrag|kunde|montør|rapport|dokument|kalender|varsler|innstillinger|søk|lagre|slett|endre|fjern)\b/i;

function looksNorwegian(value) {
  if (value.length < 2) return false;
  if (/^[/#]/.test(value) || value.includes("://")) return false;

  // Malstrenger kan inneholde kode. Vurder bare den faste teksten rundt
  // `${...}`; en URL, CSS-regel eller klasse er ikke UI-prosa.
  const literalParts = value.replace(/\$\{[\s\S]*?\}/g, "").trim();
  if (!literalParts) return false;
  if (/^[?&.#]/.test(literalParts)) return false;
  if (literalParts.includes("/api/") || literalParts.includes("--")) return false;
  if (/[{}]/.test(literalParts)) return false;

  // Flersidige kodestumper som havner i en malstreng er ikke UI-tekst.
  if (value.includes("\n") && /(?:[;{}]|=>|\/\/)/.test(value)) return false;

  if (/[æøåÆØÅ]/.test(literalParts)) return true;
  return /\s/.test(literalParts) && NORWEGIAN_WORDS.test(literalParts);
}

const sourceFiles = walk(path.join(root, "src"), [".ts", ".tsx"]);
const hardcoded = [];
const seenHardcoded = new Set();

function report(file, text, kind) {
  const value = text.trim();
  if (value.length < 2) return;
  const location = path.relative(root, file);
  const entry = `${kind}: ${location}: ${value.slice(0, 70)}`;
  if (seenHardcoded.has(entry)) return;
  seenHardcoded.add(entry);
  hardcoded.push(entry);
}

const norwegianText = />[^<>{}]*[æøåÆØÅ][^<>{}]*</g;
const attributeText =
  /\b(aria-label|title|placeholder)\s*=\s*("([^"]*)"|'([^']*)')/g;

for (const file of sourceFiles) {
  if (file.includes(".test.") || file.endsWith(".d.ts")) continue;
  const source = fs.readFileSync(file, "utf8");
  // Bevisste unntak dokumenteres i filen med en i18n-ignore-file-kommentar.
  if (source.includes("i18n-ignore-file")) continue;
  const stripped = stripComments(source);

  for (const match of stripped.matchAll(norwegianText)) {
    const text = match[0].slice(1, -1).trim();
    if (text.length < 2) continue;
    if (/[;=()]/.test(text)) continue; // hopp over kode som treffer regexen
    report(file, text, "jsx");
  }

  for (const match of stripped.matchAll(attributeText)) {
    const value = (match[3] ?? match[4] ?? "").trim();
    if (!/[A-Za-zÆØÅæøå]/.test(value)) continue;
    // Formatmasker (YYYY-MM-DD, XXXX-XXXX) er ikke språklig tekst.
    if (/^(?:[Xx]{4}-[Xx]{4}|[Yy]{4}-[Mm]{2}-[Dd]{2})$/.test(value)) continue;
    report(file, `${match[1]}="${value}"`, "attr");
  }

  for (const match of stripped.matchAll(STRING_LITERAL)) {
    const value = match[2];
    if (!looksNorwegian(value)) continue;
    // Logg- og feilmeldinger for utviklere er ikke brukergrensesnitt.
    const lineStart = stripped.lastIndexOf("\n", match.index) + 1;
    const linePrefix = stripped.slice(lineStart, match.index);
    if (
      /console\.(log|warn|error|info|debug|trace)\s*\(/.test(linePrefix) ||
      /(?:throw new Error|new Error)\s*\(/.test(linePrefix)
    ) {
      continue;
    }
    report(file, value, "literal");
  }
}

if (hardcoded.length > 0) {
  console.warn(`⚠ i18n: ${hardcoded.length} hardkodede norske strenger`);
  for (const example of hardcoded.slice(0, 20)) console.warn(`  ${example}`);
  if (hardcoded.length > 20) console.warn("  …");
  if (strict) failed = true;
}

/**
 * Ubrukte nøkler: en nøkkel regnes som brukt når den finnes som en streng-
 * literal i kildekoden, eller når en malstrengprefiks (før `${}`) er en
 * prefiks av nøkkelen. Det dekker både `t("a.b")` og `t(\`a.${x}\`)`.
 */
const referenced = new Set();
const prefixes = new Set();

function remember(value) {
  if (!value) return;
  referenced.add(value);
  const dynamic = value.indexOf("${");
  if (dynamic >= 0) {
    const prefix = value.slice(0, dynamic);
    if (prefix.length >= 3) prefixes.add(prefix);
  }
  if (value.length >= 3 && value.endsWith(".")) prefixes.add(value);
}

/** Husk også nøkler som ligger inne i en malstreng, f.eks. `${t("a.b")}`. */
function rememberLiteral(value) {
  remember(value);
  if (value.includes('"') || value.includes("'")) {
    for (const inner of value.matchAll(STRING_LITERAL)) remember(inner[2]);
  }
}

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  const stripped = stripComments(source);
  for (const match of stripped.matchAll(STRING_LITERAL)) {
    rememberLiteral(match[2]);
  }
  // Direkte egenskapsnøkler i objekter, f.eks. `labelKey: "..."`, fanges av
  // literal-scanneren over. Malstrenger med uttrykk gir prefikser.
  for (const match of stripped.matchAll(/`([^`]*)\$\{/g)) {
    if (match[1].length >= 3) prefixes.add(match[1]);
  }

  // Kortform: filer som bruker én namespace kaller ofte `t("kort.nøkkel")`.
  // Normaliser `common.` bort, siden katalogene er flatet ut under common.
  const namespaces = new Set(
    [...stripped.matchAll(
      /(?:useTranslations|getTranslations)\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    )].map((match) => match[1].replace(/^common\.?/, "")),
  );
  if (namespaces.size === 1) {
    const namespace = [...namespaces][0];
    for (const match of stripped.matchAll(/\bt\(\s*["']([^"']+)["']\s*[,)]/g)) {
      const key = match[1];
      remember(namespace ? `${namespace}.${key}` : key);
    }
  }
}

const unusedKeys = [...nbKeys].filter((key) => {
  if (referenced.has(key)) return false;
  for (const prefix of prefixes) {
    if (key.startsWith(prefix)) return false;
  }
  return true;
});

if (unusedKeys.length > 0) {
  console.warn(`⚠ i18n: ${unusedKeys.length} nøkler uten kjente brukere`);
  for (const key of unusedKeys.slice(0, 20)) console.warn(`  ${key}`);
  if (unusedKeys.length > 20) console.warn("  …");
  if (strict) failed = true;
} else {
  console.log("✓ i18n: alle nøkler er referert i kildekoden");
}

process.exit(failed ? 1 : 0);
