#!/usr/bin/env node
/**
 * Lister katalog-nøkler som ikke er referert i kildekoden.
 *
 *   node scripts/i18n-unused.mjs            # menneskelesbar rapport
 *   node scripts/i18n-unused.mjs --json     # maskinlesbar JSON
 *   node scripts/i18n-unused.mjs --fail     # exit 1 når noe er ubrukt
 *
 * Skriptet er bevisst konservativt: en nøkkel regnes som brukt når den finnes
 * som streng-literal, som prefiks i en malstreng (`t(\`a.${x}\`)`), eller når
 * den ligger under et dokumentert dynamisk prefiks. Da kan rapporten brukes
 * som grunnlag for sletting uten å fjerne nøkler som bygges i kode.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const jsonOutput = process.argv.includes("--json");
const failOnUnused = process.argv.includes("--fail");

/** Prefikser der nøkkelen bygges fra data, ikke fra en literals i JSX. */
export const DYNAMIC_PREFIXES = [
  "auditActions.",
  "errors.",
  "metadata.",
  "settings.permissions.items.",
  "settings.roles.builtIn.",
];

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const IDENTIFIER = /^[A-Za-z0-9_$]+$/;

function deepMerge(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = result[key];
    result[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
        ? deepMerge(existing, value)
        : value;
  }
  return result;
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

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

/** Fjerner kommentarer uten å miste strenger. Samme forenkling som check-i18n. */
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

const referenced = new Set();
const prefixes = new Set(DYNAMIC_PREFIXES);

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

function rememberLiteral(value) {
  remember(value);
  if (value.includes('"') || value.includes("'")) {
    for (const inner of value.matchAll(STRING_LITERAL)) remember(inner[2]);
  }
}

function readMessages(locale) {
  const base = JSON.parse(
    fs.readFileSync(path.join(root, `messages/${locale}.json`), "utf8"),
  );
  const fragmentsDir = path.join(root, "messages/fragments");
  let merged = base.common ?? {};
  for (const file of fs.readdirSync(fragmentsDir)) {
    if (!file.endsWith(`.${locale}.json`)) continue;
    const fragment = JSON.parse(
      fs.readFileSync(path.join(fragmentsDir, file), "utf8"),
    );
    merged = deepMerge(merged, fragment);
  }
  return merged;
}

function keySources() {
  const sources = new Map();
  const base = JSON.parse(
    fs.readFileSync(path.join(root, "messages/nb.json"), "utf8"),
  ).common ?? {};
  for (const key of flatten(base)) sources.set(key, "messages/nb.json");

  const fragmentsDir = path.join(root, "messages/fragments");
  for (const file of fs.readdirSync(fragmentsDir)) {
    if (!file.endsWith(".nb.json")) continue;
    const fragment = JSON.parse(
      fs.readFileSync(path.join(fragmentsDir, file), "utf8"),
    );
    const relative = `messages/fragments/${file}`;
    for (const key of flatten(fragment)) {
      if (!sources.has(key)) sources.set(key, relative);
    }
  }
  return sources;
}

const sourceFiles = walk(path.join(root, "src"));
for (const file of sourceFiles) {
  if (file.includes(".test.") || file.endsWith(".d.ts")) continue;
  const source = fs.readFileSync(file, "utf8");
  const stripped = stripComments(source);

  for (const match of stripped.matchAll(STRING_LITERAL)) {
    const value = match[2];
    rememberLiteral(value);
  }

  // Direkte JSON-import, f.eks. global-error.tsx som leser
  // `errorsNb.errors.global.title` utenfor next-intl.
  for (const match of source.matchAll(
    /import\s+([A-Za-z0-9_$]+)\s+from\s+["'][^"']*messages\/[^"']+\.json["']/g,
  )) {
    const alias = match[1];
    const access = new RegExp(`\\b${alias}((?:\\.[A-Za-z0-9_$]+)+)`, "g");
    for (const hit of stripped.matchAll(access)) {
      remember(hit[1].slice(1));
    }
  }

  for (const match of stripped.matchAll(/`([^`]*)\$\{/g)) {
    if (match[1].length >= 3) prefixes.add(match[1]);
  }

  // Kortform: filer med én namespace kaller ofte `t("kort.nøkkel")`.
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

const keys = new Set(flatten(readMessages("nb")));
const sources = keySources();
const unused = [...keys]
  .filter((key) => {
    if (referenced.has(key)) return false;
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) return false;
    }
    return true;
  })
  .sort();

const grouped = new Map();
for (const key of unused) {
  const source = sources.get(key) ?? "ukjent";
  if (!grouped.has(source)) grouped.set(source, []);
  grouped.get(source).push(key);
}

if (jsonOutput) {
  console.log(
    JSON.stringify(
      {
        totalKeys: keys.size,
        unusedKeys: unused.length,
        dynamicPrefixes: [...prefixes].sort(),
        files: Object.fromEntries(
          [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)),
        ),
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `✓ ${keys.size} nøkler; ${unused.length} uten kjente brukere`,
  );
  for (const [source, list] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`\n# ${source} (${list.length})`);
    for (const key of list) console.log(key);
  }
  if (unused.length === 0) {
    console.log("\n✓ alle nøkler er referert");
  }
}

if (failOnUnused && unused.length > 0) process.exit(1);
