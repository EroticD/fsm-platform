#!/usr/bin/env node
/**
 * Sjekker at nb.json og en.json har samme nøkler, og rapporterer hardkodede
 * norske strenger i JSX.
 *
 *   node scripts/check-i18n.mjs            # parity er streng, hardkodet er varsel
 *   node scripts/check-i18n.mjs --strict   # også hardkodet norsk feiler
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nb = JSON.parse(fs.readFileSync(path.join(root, "messages/nb.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(root, "messages/en.json"), "utf8"));

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

const nbKeys = new Set(flatten(nb));
const enKeys = new Set(flatten(en));
const missingInEn = [...nbKeys].filter((key) => !enKeys.has(key));
const missingInNb = [...enKeys].filter((key) => !nbKeys.has(key));

let failed = false;
if (missingInEn.length || missingInNb.length) {
  failed = true;
  console.error("✖ i18n: nøklene stemmer ikke");
  if (missingInEn.length) console.error("  Mangler i en.json:", missingInEn.join(", "));
  if (missingInNb.length) console.error("  Mangler i nb.json:", missingInNb.join(", "));
} else {
  console.log(`✓ i18n: ${nbKeys.size} nøkler i begge filer`);
}

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const norwegianText = />[^<>{}]*[æøåÆØÅ][^<>{}]*</g;
const hardcoded = [];
for (const file of walk(path.join(root, "src"))) {
  if (file.includes(".test.")) continue;
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(norwegianText)) {
    const text = match[0].slice(1, -1).trim();
    if (text.length < 2) continue;
    hardcoded.push(`${path.relative(root, file)}: ${text.slice(0, 70)}`);
  }
}

if (hardcoded.length > 0) {
  console.warn(`⚠ i18n: ${hardcoded.length} hardkodede norske tekstnoder i JSX`);
  for (const example of hardcoded.slice(0, 20)) console.warn(`  ${example}`);
  if (hardcoded.length > 20) console.warn("  …");
  if (process.argv.includes("--strict")) failed = true;
}

process.exit(failed ? 1 : 0);
