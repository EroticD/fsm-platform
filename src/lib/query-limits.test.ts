import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Sider skal aldri laste en ubegrenset liste. Denne statiske testen finner alle
 * `findMany`-kall i sidekomponentene og krever at de enten har `take` eller
 * gjelder en liten, kjent tabell (roller, avdelinger, tags og maler).
 *
 * Testen leser kildekoden i stedet for å kjøre spørringene, slik at den også
 * fanger opp nye sider uten database.
 */

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

/** Små oppslagstabeller der hele listen er en del av UI-en. */
const ALLOWED_UNBOUNDED = new Set([
  "role",
  "department",
  "tag",
  "documenttag",
  "template",
  "branding",
]);

function pageFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(fullPath);
    return entry.name === "page.tsx" ? [fullPath] : [];
  });
}

/** Finner parentesen som lukker kallet som starter ved `openIndex`. */
function findClosingParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Henter egenskapene på rotnivå i argumentobjektet. Da teller ikke `take` på
 * en nestet relasjon (f.eks. `include: { reports: { take: 1 } }`) som et tak på
 * selve listespørringen.
 */
function rootObjectProperties(call: string): string {
  let depth = 0;
  let result = "";
  let quote: string | null = null;
  let escaped = false;

  for (const char of call) {
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      continue;
    }
    if (depth === 1) result += char;
  }

  return result;
}

describe("query limits i sider", () => {
  it("har take på alle findMany-kall, med mindre tabellen er liten", () => {
    const violations: string[] = [];

    for (const file of pageFiles(APP_DIR)) {
      const source = fs.readFileSync(file, "utf8");
      const matches = [...source.matchAll(/\.findMany\s*\(/g)];

      for (const match of matches) {
        const openIndex = match.index! + match[0].length - 1;
        const closeIndex = findClosingParen(source, openIndex);
        if (closeIndex === -1) {
          violations.push(`${path.relative(APP_DIR, file)}: fant ikke avslutning på findMany`);
          continue;
        }

        const before = source.slice(0, match.index).trimEnd();
        const modelMatch = before.match(/([A-Za-z_$][\w$]*)$/);
        const model = modelMatch?.[1]?.toLowerCase() ?? "";

        const call = source.slice(openIndex, closeIndex + 1);
        if (ALLOWED_UNBOUNDED.has(model)) continue;
        if (/\btake\s*:/.test(rootObjectProperties(call))) continue;

        violations.push(
          `${path.relative(APP_DIR, file)}:${lineNumberAt(source, match.index!)} ` +
            `(${model || "ukjent modell"}) mangler take`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
