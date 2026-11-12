#!/usr/bin/env node
/**
 * Legger én nøkkel i alle fire oversettelseskataloger samtidig.
 *
 *   node scripts/i18n-add.mjs <dottet.nokkel> --nb "..." --en "..." \
 *     --pl "..." --de "..." [--force] [--dry-run]
 *
 * Nøkkelen er relativ til `common`-navnerommet, altså slik den brukes i
 * `t("orders.list.title")`. For hvert språk velges filen slik:
 *
 *   1. en fragmentfil i `messages/fragments/` som er importert og flettet inn
 *      i `src/i18n/messages.ts` og som allerede eier nøkkelens prefiks,
 *   2. ellers den monolittiske `messages/<språk>.json` (under `common`).
 *
 * Skrivingen er tekstbasert: bare den nye nøkkelen legges til, mens
 * formatering, rekkefølge og kommentarfri JSON ellers står urørt. Det er
 * nødvendig fordi noen kataloger har bevisst kompakte objekter på én linje.
 *
 * Hele operasjonen er atomisk: mangler en oversettelse, finnes nøkkelen fra
 * før (uten --force), eller feiler valideringen, skrives ingen filer.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const LOCALES = ["nb", "en", "pl", "de"];
const FRAGMENT_DIR = path.join(root, "messages/fragments");
const MESSAGES_TS = path.join(root, "src/i18n/messages.ts");
const KEY_PATTERN = /^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/;

const USAGE = `Bruk:
  node scripts/i18n-add.mjs <dottet.nokkel> --nb "..." --en "..." --pl "..." --de "..." [--force] [--dry-run]

Eksempel:
  node scripts/i18n-add.mjs orders.list.title --nb "Oppdrag" --en "Work orders" \\
    --pl "Zlecenia" --de "Aufträge"

Flagg:
  --force     overskriv verdien hvis nøkkelen finnes fra før
  --dry-run   vis filer og diff uten å skrive
  --help      vis denne hjelpen`;

function fail(message) {
  console.error(`✖ i18n:add: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { key: null, values: {}, force: false, dryRun: false };
  const queue = [...argv];
  while (queue.length > 0) {
    const arg = queue.shift();
    if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (/^--(nb|en|pl|de)$/.test(arg)) {
      const locale = arg.slice(2);
      const value = queue.shift();
      if (value === undefined) fail(`${arg} mangler en verdi`);
      if (locale in options.values) fail(`${arg} er oppgitt flere ganger`);
      options.values[locale] = value;
    } else if (arg.startsWith("-")) {
      fail(`ukjent flagg «${arg}»\n\n${USAGE}`);
    } else if (options.key === null) {
      options.key = arg;
    } else {
      fail(`uventet argument «${arg}» (nøkkelen er allerede satt til «${options.key}»)`);
    }
  }
  return options;
}

/* ------------------------------------------------------------------ *
 * JSON med tegnposisjoner, slik at vi kan sette inn tekst i stedet for
 * å serialisere hele treet på nytt.
 * ------------------------------------------------------------------ */

function parseJsonWithOffsets(text) {
  let index = 0;
  const length = text.length;
  const failAt = (message) => {
    throw new Error(`${message} (tegn ${index})`);
  };

  function skipWhitespace() {
    while (index < length && /\s/.test(text[index])) index += 1;
  }

  function parseString() {
    const start = index;
    if (text[index] !== '"') failAt("forventet streng");
    index += 1;
    while (index < length) {
      const char = text[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"') {
        index += 1;
        return { value: JSON.parse(text.slice(start, index)), start, end: index };
      }
      index += 1;
    }
    failAt("uavsluttet streng");
  }

  function parseValue() {
    skipWhitespace();
    const start = index;
    const char = text[index];
    if (char === "{") return parseObject();
    if (char === "[") return parseArray();
    if (char === '"') {
      const string = parseString();
      return { type: "string", value: string.value, start: string.start, end: string.end };
    }
    const primitive = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
      text.slice(index),
    );
    if (!primitive) failAt("ugyldig verdi");
    index += primitive[0].length;
    return { type: "primitive", value: JSON.parse(primitive[0]), start, end: index };
  }

  function parseObject() {
    const start = index;
    index += 1;
    const node = { type: "object", start, end: 0, children: [] };
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      node.end = index;
      return node;
    }
    for (;;) {
      skipWhitespace();
      const keyToken = parseString();
      skipWhitespace();
      if (text[index] !== ":") failAt("forventet kolon");
      index += 1;
      const valueNode = parseValue();
      node.children.push({
        key: keyToken.value,
        keyStart: keyToken.start,
        valueNode,
      });
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "}") {
        index += 1;
        node.end = index;
        return node;
      }
      failAt("forventet , eller }");
    }
  }

  function parseArray() {
    const start = index;
    index += 1;
    const node = { type: "array", start, end: 0, items: [] };
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      node.end = index;
      return node;
    }
    for (;;) {
      node.items.push(parseValue());
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "]") {
        index += 1;
        node.end = index;
        return node;
      }
      failAt("forventet , eller ]");
    }
  }

  const node = parseValue();
  skipWhitespace();
  if (index !== length) failAt("uventet innhold etter JSON");
  return node;
}

/** Finner noden for en nøkkelsti, eller undefined. Siste duplikat vinner. */
function findNode(node, segments) {
  let current = node;
  for (const segment of segments) {
    if (!current || current.type !== "object") return undefined;
    const children = current.children.filter((child) => child.key === segment);
    if (children.length === 0) return undefined;
    current = children[children.length - 1].valueNode;
  }
  return current;
}

function hasKeyCollision(node, segments) {
  let current = node;
  for (let depth = 0; depth < segments.length; depth += 1) {
    if (!current || current.type !== "object") return false;
    const child = current.children.find((entry) => entry.key === segments[depth]);
    if (!child) return false;
    if (depth === segments.length - 1) return true;
    current = child.valueNode;
  }
  return false;
}

function indentationBefore(text, position) {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return text.slice(lineStart, position);
}

function detectUnit(text, rootNode) {
  const first = rootNode.type === "object" ? rootNode.children[0] : undefined;
  if (first) {
    const indent = indentationBefore(text, first.keyStart);
    if (/^[ \t]+$/.test(indent)) return indent;
  }
  return "  ";
}

/** `"nøkkel": verdi` med innrykk for nestede objekter. */
function renderKey(segments, value, indent, unit) {
  const [head, ...rest] = segments;
  if (rest.length === 0) return `${JSON.stringify(head)}: ${JSON.stringify(value)}`;
  const inner = indent + unit;
  return `${JSON.stringify(head)}: {\n${inner}${renderKey(rest, value, inner, unit)}\n${indent}}`;
}

/** Samme som renderKey, men på én linje (for kompakte objekter). */
function renderInlineKey(segments, value) {
  const [head, ...rest] = segments;
  if (rest.length === 0) return `${JSON.stringify(head)}: ${JSON.stringify(value)}`;
  return `${JSON.stringify(head)}: { ${renderInlineKey(rest, value)} }`;
}

/** Setter inn en ny nøkkel (siste ledd) under dens overordnede objekt. */
function insertKey(text, rootNode, segments, value, unit) {
  const [head, ...rest] = segments;

  function walk(node, remaining) {
    const [current, ...tail] = remaining;
    const existing = [...node.children].reverse().find((child) => child.key === current);
    if (existing && tail.length > 0) {
      if (existing.valueNode.type !== "object") {
        throw new Error(
          `«${current}» er en tekstverdi, ikke et objekt, og kan ikke utvides`,
        );
      }
      return walk(existing.valueNode, tail);
    }
    if (existing) {
      throw new Error(`«${remaining.join(".")}» finnes allerede`);
    }

    const tailSegments = [current, ...tail];
    const first = node.children[0];

    if (first) {
      const childIndent = indentationBefore(text, first.keyStart);
      const multiline = text.slice(node.start + 1, first.keyStart).includes("\n");
      const insertionPoint = node.children[node.children.length - 1].valueNode.end;
      const addition = multiline
        ? `,\n${childIndent}${renderKey(tailSegments, value, childIndent, unit)}`
        : `, ${renderInlineKey(tailSegments, value)}`;
      return text.slice(0, insertionPoint) + addition + text.slice(insertionPoint);
    }

    const objectIndent = node === rootNode ? "" : indentationBefore(text, node.start);
    const inner = objectIndent + unit;
    const addition = `\n${inner}${renderKey(tailSegments, value, inner, unit)}\n${objectIndent}`;
    return text.slice(0, node.start + 1) + addition + text.slice(node.end - 1);
  }

  return walk(rootNode, [head, ...rest]);
}

/* ------------------------------------------------------------------ *
 * Hvilken fil eier en nøkkel for et språk?
 * ------------------------------------------------------------------ */

function readWiring() {
  const source = fs.readFileSync(MESSAGES_TS, "utf8");
  const imports = new Map();
  for (const match of source.matchAll(
    /import\s+(\w+)\s+from\s+["']([^"']*messages\/fragments\/([^"']+)\.(nb|en|pl|de)\.json)["']/g,
  )) {
    imports.set(match[1], {
      file: path.resolve(path.dirname(MESSAGES_TS), match[2]),
      locale: match[4],
    });
  }

  /** Kun fragmenter som faktisk er flettet inn i riktig språks mergeAll-liste. */
  const merged = new Map(LOCALES.map((locale) => [locale, []]));
  for (const match of source.matchAll(/(\w+)Fragments\s*=\s*mergeAll\(\[([\s\S]*?)\]\)/g)) {
    const locale = LOCALES.find((candidate) => match[1].endsWith(candidate));
    if (!locale) continue;
    for (const identifier of match[2].matchAll(/\b(\w+)\b/g)) {
      const entry = imports.get(identifier[1]);
      if (entry && entry.locale === locale) merged.get(locale).push(entry.file);
    }
  }
  return merged;
}

const wiring = readWiring();
const parsedCache = new Map();

function fileInfo(file) {
  if (!parsedCache.has(file)) {
    const text = fs.readFileSync(file, "utf8");
    parsedCache.set(file, { text, root: parseJsonWithOffsets(text) });
  }
  return parsedCache.get(file);
}

/**
 * Alle filer som kan inneholde nøkkelen for et språk: fragmentene som er
 * flettet inn, pluss den monolittiske katalogen (under `common`).
 */
function catalogFiles(locale) {
  const files = [];
  for (const file of wiring.get(locale) ?? []) {
    files.push({ file, prefix: [], kind: "fragment" });
  }
  const monolithic = path.join(root, `messages/${locale}.json`);
  if (fs.existsSync(monolithic)) {
    files.push({ file: monolithic, prefix: ["common"], kind: "monolithic" });
  }
  return files;
}

function longestSharedPrefix(segments, node) {
  let depth = 0;
  let current = node;
  while (current && current.type === "object" && depth < segments.length) {
    const child = current.children.find((entry) => entry.key === segments[depth]);
    if (!child) break;
    depth += 1;
    current = child.valueNode;
  }
  return depth;
}

function chooseTarget(locale, segments) {
  const top = segments[0];
  const candidates = catalogFiles(locale).filter((entry) => entry.kind === "fragment");
  const scored = [];
  for (const entry of candidates) {
    const { root: rootNode } = fileInfo(entry.file);
    if (rootNode.type !== "object") continue;
    if (!rootNode.children.some((child) => child.key === top)) continue;
    scored.push({ ...entry, depth: longestSharedPrefix(segments, rootNode) });
  }

  const baseName = top.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  const byBaseName = scored.find(
    (entry) => path.basename(entry.file).replace(/\.(nb|en|pl|de)\.json$/, "") === baseName,
  );
  const bestDepth = scored.reduce((max, entry) => Math.max(max, entry.depth), 0);

  if (bestDepth >= 2) {
    const deepest = scored.filter((entry) => entry.depth === bestDepth);
    const chosen = byBaseName && byBaseName.depth === bestDepth ? byBaseName : deepest[0];
    return { file: chosen.file, prefix: [] };
  }
  if (byBaseName) return { file: byBaseName.file, prefix: [] };

  return { file: path.join(root, `messages/${locale}.json`), prefix: ["common"] };
}

function describeValue(value) {
  if (value === undefined) return "(finnes ikke)";
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value === "object" ? "objekt" : String(value);
}

/* ------------------------------------------------------------------ *
 * Diff for --dry-run
 * ------------------------------------------------------------------ */

function lineDiff(before, after, context = 3) {
  const from = before.split("\n");
  const to = after.split("\n");
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head += 1;
  let tailFrom = from.length - 1;
  let tailTo = to.length - 1;
  while (tailFrom >= head && tailTo >= head && from[tailFrom] === to[tailTo]) {
    tailFrom -= 1;
    tailTo -= 1;
  }
  const start = Math.max(0, head - context);
  const lines = [`@@ -${start + 1} +${start + 1} @@`];
  for (let index = start; index < head; index += 1) lines.push(`  ${from[index]}`);
  for (let index = head; index <= tailFrom; index += 1) lines.push(`- ${from[index]}`);
  for (let index = head; index <= tailTo; index += 1) lines.push(`+ ${to[index]}`);
  const tailEnd = Math.min(from.length, tailFrom + 1 + context);
  for (let index = tailFrom + 1; index < tailEnd; index += 1) lines.push(`  ${from[index]}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Hovedflyt
 * ------------------------------------------------------------------ */

const options = parseArgs(process.argv.slice(2));
if (!options.key) fail(`mangler nøkkel\n\n${USAGE}`);

let key = options.key;
if (key.startsWith("common.")) key = key.slice("common.".length);
if (!KEY_PATTERN.test(key)) {
  fail(`«${options.key}» er ikke en gyldig dottet nøkkel (bokstaver, tall, _ og - i hvert ledd)`);
}
const segments = key.split(".");
if (segments.length < 2) {
  fail(`nøkkelen må ha minst to ledd, f.eks. «${key}.tittel»`);
}

const missing =
  LOCALES.filter((locale) => (options.values[locale] ?? "").trim().length === 0);
if (missing.length > 0) {
  fail(
    `mangler oversettelse for ${missing.join(", ")} – oppgi ${missing
      .map((locale) => `--${locale} "..."`)
      .join(" ")}. Ingen filer er skrevet.`,
  );
}
for (const locale of LOCALES) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(options.values[locale])) {
    fail(`--${locale} inneholder kontrolltegn`);
  }
}

const plans = [];
for (const locale of LOCALES) {
  const target = chooseTarget(locale, segments);
  const fullPath = [...target.prefix, ...segments];
  const { text, root: rootNode } = fileInfo(target.file);

  // Finnes nøkkelen allerede, et sted i dette språkets kataloger?
  let existing;
  for (const catalog of catalogFiles(locale)) {
    const info = fileInfo(catalog.file);
    const path_ = [...catalog.prefix, ...segments];
    if (hasKeyCollision(info.root, path_)) {
      existing = { file: catalog.file, prefix: catalog.prefix, node: findNode(info.root, path_) };
      break;
    }
  }

  const value = options.values[locale];

  if (existing) {
    const location = `${path.relative(root, existing.file)} (${describeValue(existing.node?.value)})`;
    if (!options.force) {
      fail(
        `«${key}» finnes allerede for ${locale} i ${location}. Bruk --force for å overskrive.`,
      );
    }
    if (existing.node?.type === "object" || existing.node?.type === "array") {
      fail(
        `«${key}» er et objekt for ${locale} i ${location}; vil du legge til en undersnøkkel, oppgi hele stien.`,
      );
    }
    const owner = fileInfo(existing.file);
    const existingText = owner.text;
    const nextText =
      existingText.slice(0, existing.node.start) +
      JSON.stringify(value) +
      existingText.slice(existing.node.end);
    plans.push({
      locale,
      file: existing.file,
      fullPath: [...existing.prefix, ...segments],
      before: existingText,
      after: nextText,
      action: "overskriv",
    });
    continue;
  }

  const { root: targetRoot } = fileInfo(target.file);
  if (targetRoot.type !== "object") {
    fail(`${path.relative(root, target.file)} har ikke et JSON-objekt på toppen`);
  }
  const unit = detectUnit(text, targetRoot);
  const after = insertKey(text, targetRoot, fullPath, value, unit);
  plans.push({
    locale,
    file: target.file,
    fullPath,
    before: text,
    after,
    action: "legg til",
  });
}

// Valider alt før noe skrives: gyldig JSON og nøkkelen på plass med riktig verdi.
for (const plan of plans) {
  try {
    JSON.parse(plan.after);
  } catch (error) {
    fail(`intern feil: ${path.relative(root, plan.file)} ble ugyldig JSON (${error.message})`);
  }
  const node = findNode(parseJsonWithOffsets(plan.after), plan.fullPath);
  if (!node || node.value !== options.values[plan.locale]) {
    fail(
      `intern feil: klarte ikke å plassere «${plan.fullPath.join(".")}» i ${path.relative(root, plan.file)}`,
    );
  }
}

const uniqueFiles = new Set(plans.map((plan) => plan.file));
console.log(
  `${options.dryRun ? "tørrkjøring" : "✓ i18n:add"}: «${key}» i ${plans.length} kataloger (${uniqueFiles.size} filer)`,
);
for (const plan of plans) {
  console.log(
    `  ${plan.locale}  ${path.relative(root, plan.file)}  → ${plan.fullPath.join(".")}  (${plan.action})`,
  );
}

if (options.dryRun) {
  console.log("");
  for (const plan of plans) {
    console.log(`--- ${path.relative(root, plan.file)}`);
    console.log(lineDiff(plan.before, plan.after));
    console.log("");
  }
  console.log("tørrkjøring: ingen filer er skrevet");
  process.exit(0);
}

for (const plan of plans) {
  fs.writeFileSync(plan.file, plan.after, "utf8");
}

// Skrivingen er gjort – les tilbake og valider hver berørte fil.
const written = [...uniqueFiles];
for (const file of written) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${path.relative(root, file)} er ikke gyldig JSON etter skriving: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object") fail(`${path.relative(root, file)} er ikke et objekt`);
}
console.log(
  `✓ validerte ${written.length} filer: ${written
    .map((file) => path.relative(root, file))
    .join(", ")}`,
);
console.log(
  `Neste steg: bruk nøkkelen i koden og kjør «npm run check:i18n:strict».`,
);
