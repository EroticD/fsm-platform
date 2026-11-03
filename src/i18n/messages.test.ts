import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "./messages";

const LOCALES = ["nb", "en", "pl", "de"] as const;
const FRAGMENT_DIR = path.join(process.cwd(), "messages", "fragments");

function leafPaths(value: unknown, prefix: string[] = []): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix.join(".")];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => leafPaths(child, [...prefix, key]),
  );
}

function hasPath(root: unknown, key: string): boolean {
  let current: unknown = root;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object") return false;
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined;
}

describe("i18n fragment wiring", () => {
  it("har norsk og engelsk variant av hver fragmentfil", () => {
    const files = readdirSync(FRAGMENT_DIR);
    const bases = [
      ...new Set(
        files
          .filter((file) => file.endsWith(".json"))
          .map((file) => file.replace(/\.(nb|en|pl|de)\.json$/, "")),
      ),
    ];

    for (const base of bases) {
      expect(files, `${base}.nb.json mangler`).toContain(`${base}.nb.json`);
      expect(files, `${base}.en.json mangler`).toContain(`${base}.en.json`);
    }
  });

  it("fletter hver fragmentnøkkel inn i alle fire språk", () => {
    const files = readdirSync(FRAGMENT_DIR).filter((file) =>
      file.endsWith(".json"),
    );

    for (const file of files) {
      const locale = file.slice(-7, -5) as (typeof LOCALES)[number];
      if (!LOCALES.includes(locale)) continue;
      const fragment = JSON.parse(
        readFileSync(path.join(FRAGMENT_DIR, file), "utf8"),
      ) as unknown;
      for (const key of leafPaths(fragment)) {
        expect(
          hasPath(messages[locale].common, key),
          `${file}: ${key} er ikke flettet inn i messages.${locale}.common`,
        ).toBe(true);
      }
    }
  });
});
