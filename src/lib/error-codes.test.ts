import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isApiErrorCode } from "./api-errors";
import { ERROR_CODES, isErrorCode, type ErrorCode } from "./error-codes";

/**
 * Testen leser kildene med `fs` i stedet for å duplisere kodene. Da fanger den
 * nye koder og skrivefeil uten at noen må huske å oppdatere en liste her.
 */

const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(integration\.)?test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relativeLines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n");
}

/** Presise koder har minst ett prefiksledd, f.eks. `invoice.locked`. */
const PREFIXED_CODE = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

const registered = new Set<string>(Object.keys(ERROR_CODES));

/** Bare stedene der tjenestene produserer `details.code`. */
const sourceFiles = [path.join(SRC, "server"), path.join(SRC, "app")].flatMap((dir) => walk(dir));

/**
 * `code: "..."` der koden havner i `details.code`, altså ikke:
 * - `orderBy: { code: "asc" }` (produktkode som sorteringsnøkkel)
 * - HTTP-konvolutten `{ error: { code } }`, som eies av `ApiErrorCode`
 */
function detailCodeLiterals(): { code: string; where: string }[] {
  const found: { code: string; where: string }[] = [];
  const pattern = /\bcode:\s*"([^"]+)"/g;
  for (const file of sourceFiles) {
    const lines = relativeLines(file);
    lines.forEach((line, index) => {
      if (/orderBy:/.test(line)) return;
      for (const match of line.matchAll(pattern)) {
        const code = match[1];
        if (isApiErrorCode(code)) continue;
        found.push({
          code,
          where: `${path.relative(process.cwd(), file)}:${index + 1}`,
        });
      }
    });
  }
  return found;
}

/** Verdiene i modulenes eksporterte `*_ERROR_CODES`-tabeller. */
function moduleCodeTableValues(): { code: string; where: string }[] {
  const found: { code: string; where: string }[] = [];
  const table = /const\s+\w*ERROR_CODES\s*=\s*\{([\s\S]*?)\}\s*as\s+const/g;
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    for (const tableMatch of text.matchAll(table)) {
      const startLine = text.slice(0, tableMatch.index).split("\n").length;
      for (const valueMatch of tableMatch[1].matchAll(/:\s*"([^"]+)"/g)) {
        found.push({
          code: valueMatch[1],
          where: `${path.relative(process.cwd(), file)}:~${startLine}`,
        });
      }
    }
  }
  return found;
}

function feedbackFiles(): { module: string; file: string; codes: string[] }[] {
  const app = path.join(SRC, "app");
  return readdirSync(app, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      module: entry.name,
      file: path.join(app, entry.name, "feedback.ts"),
    }))
    .filter(({ file }) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    })
    .map(({ module, file }) => {
      const text = readFileSync(file, "utf8");
      // Koder står enten som nøkkel i en map (`"invoice.locked": ...`) eller
      // som verdi i et `new Set([...])`. Meldingstekstene (i18n-nøklene) er
      // verdier og skal ikke tolkes som koder.
      const keys = [...text.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]);
      const setValues = [...text.matchAll(/new Set\(\[([\s\S]*?)\]\)/g)].flatMap((match) =>
        [...match[1].matchAll(/"([^"]+)"/g)].map((value) => value[1]),
      );
      const codes = [...keys, ...setValues].filter((value) => PREFIXED_CODE.test(value));
      return { module, file, codes: [...new Set(codes)] };
    });
}

/**
 * Hvilke kodenamesrom hver feedback-mappe må dekke. Kunder bruker
 * `ServiceError`-årsaker i query-parametrene og har ingen `details.code`.
 */
const FEEDBACK_SCOPES: Record<string, string[]> = {
  faktura: ["invoice."],
  tilbud: ["quote.", "token."],
  kunder: [],
};

describe("ERROR_CODES", () => {
  it("bruker koden som nøkkel og verdi, uten duplikater", () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value, `nøkkelen ${key} peker på en annen kode`).toBe(key);
    }
    expect(new Set(Object.values(ERROR_CODES)).size).toBe(Object.keys(ERROR_CODES).length);
  });

  it("gjenkjenner registrerte koder og avviser alt annet", () => {
    expect(isErrorCode("invoice.locked")).toBe(true);
    expect(isErrorCode("visits.errors.overlap")).toBe(true);
    expect(isErrorCode("invoice.finnesIkke")).toBe(false);
    expect(isErrorCode("")).toBe(false);
    expect(isErrorCode(null)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    expect(isErrorCode({ code: "invoice.locked" })).toBe(false);
  });

  it("har en post for hver kode som produseres i src/server og src/app", () => {
    const missing = [
      ...detailCodeLiterals(),
      ...moduleCodeTableValues(),
    ].filter((entry) => !registered.has(entry.code));

    expect(
      missing,
      `ukjente feilkoder (legg dem i ERROR_CODES):\n${missing
        .map((entry) => `  ${entry.code} @ ${entry.where}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("inneholder ingen koder som ikke produseres lenger", () => {
    const produced = new Set<string>([
      ...detailCodeLiterals().map((entry) => entry.code),
      ...moduleCodeTableValues().map((entry) => entry.code),
      ...feedbackFiles().flatMap((entry) => entry.codes),
    ]);

    const dead = [...registered].filter((code) => !produced.has(code)).sort();
    expect(dead, `koder uten produsent (fjern dem eller ta dem i bruk):\n${dead.join("\n")}`).toEqual(
      [],
    );
  });

  it("registrerer hver kode som en feedback-mappe kjenner", () => {
    const unknown = feedbackFiles().flatMap((entry) =>
      entry.codes
        .filter((code) => !registered.has(code))
        .map((code) => `${entry.module}/feedback.ts: ${code}`),
    );

    expect(unknown, `feedback-mapper med ukjente koder:\n${unknown.join("\n")}`).toEqual([]);
  });

  it("lar hver feedback-mappe dekke alle kodene i sitt kodenamesrom", () => {
    const gaps: string[] = [];
    const allCodes = Object.keys(ERROR_CODES) as ErrorCode[];
    for (const entry of feedbackFiles()) {
      const prefixes = FEEDBACK_SCOPES[entry.module] ?? [];
      const handled = new Set<string>(entry.codes);
      for (const code of allCodes) {
        if (!prefixes.some((prefix) => code.startsWith(prefix))) continue;
        if (!handled.has(code)) gaps.push(`${entry.module}/feedback.ts mangler ${code}`);
      }
    }

    expect(gaps, gaps.join("\n")).toEqual([]);
  });
});
