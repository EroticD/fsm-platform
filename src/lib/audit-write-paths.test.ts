import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vakt mot at revisjonsloggen skrives utenom hash-kjeden.
 *
 * `AuditLog` må bare skrives gjennom `audit()` eller `auditStandalone()` i
 * `src/lib/audit.ts`. En direkte `auditLog.create` gir en rad uten `hash` og
 * `prevHash`, og da feiler `verifyAuditChain` med `missing_hash` – hele
 * beviskjeden underkjennes, ikke bare én hendelse.
 *
 * Demo-seeden er unntatt: den lager testdata i en egen database og kjører
 * utenfor appen.
 */
const ROOTS = ["src", "scripts"];
const ALLOWED = new Set(["src/lib/audit.ts", "scripts/seed-e2e.mjs"]);

function walk(directory: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.includes(".test.")) {
      entries.push(path);
    }
  }
  return entries;
}

describe("revisjonsloggen skrives bare gjennom hash-kjeden", () => {
  it("har ingen direkte auditLog.create utenom audit.ts", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const path of walk(root)) {
        const key = relative(process.cwd(), path);
        if (ALLOWED.has(key)) continue;
        const source = readFileSync(path, "utf8");
        if (source.includes("auditLog.create")) {
          offenders.push(key);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
