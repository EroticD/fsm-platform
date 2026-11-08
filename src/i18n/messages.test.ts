import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES } from "../lib/modules";
import { STAFF_NAV } from "../lib/navigation";
import { messages } from "./messages";

const LOCALES = ["nb", "en", "pl", "de"] as const;
const FRAGMENT_DIR = path.join(process.cwd(), "messages", "fragments");
const P2_MODULE_KEYS = [
  "quotes",
  "invoicing",
  "inventory",
  "fieldExpenses",
  "bi",
] as const;
const P2_NAV_HREFS = [
  "/tilbud",
  "/faktura",
  "/lager",
  "/utlegg",
  "/lonnsomhet",
] as const;
const STALE_P2_WORDING =
  /\(P2\)|ikke levert|not delivered|noch nicht geliefert|jeszcze nie dostarczone/i;

function leafPaths(value: unknown, prefix: string[] = []): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix.join(".")];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => leafPaths(child, [...prefix, key]),
  );
}

function getPath(root: unknown, key: string): unknown {
  let current: unknown = root;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function hasPath(root: unknown, key: string): boolean {
  return getPath(root, key) !== undefined;
}

function expectNonEmptyText(value: unknown, message: string) {
  expect(typeof value === "string" && value.trim().length > 0, message).toBe(
    true,
  );
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

describe("P2-moduler i innstillinger og navigasjon", () => {
  it("har label og beskrivelse uten planlagt-språk i alle fire språk", () => {
    for (const locale of LOCALES) {
      for (const key of P2_MODULE_KEYS) {
        const definition = MODULES.find((mod) => mod.key === key);
        expect(definition, `${key} mangler i modulkatalogen`).toBeDefined();
        const label = getPath(messages[locale].common, definition!.labelKey);
        const description = getPath(
          messages[locale].common,
          definition!.descriptionKey,
        );

        expectNonEmptyText(label, `${locale}: ${key} mangler label`);
        expectNonEmptyText(
          description,
          `${locale}: ${key} mangler beskrivelse`,
        );
        expect(
          `${String(label)} ${String(description)}`,
          `${locale}: ${key} har fortsatt planlagt-språk`,
        ).not.toMatch(STALE_P2_WORDING);
      }
    }
  });

  it("har navigasjonstitler i alle fire språk", () => {
    const items = STAFF_NAV.filter((item) =>
      (P2_NAV_HREFS as readonly string[]).includes(item.href),
    );
    expect(items).toHaveLength(P2_NAV_HREFS.length);

    for (const locale of LOCALES) {
      for (const item of items) {
        expectNonEmptyText(
          getPath(messages[locale].common, `nav.${item.labelKey}`),
          `${locale}: ${item.href} mangler navigasjonstittel`,
        );
      }
    }
  });
});
