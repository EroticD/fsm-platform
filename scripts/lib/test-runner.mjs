/**
 * Felles filsystem- og Vitest-hjelp for test-changed.mjs og test-module.mjs.
 * Holdes fri for git og argumentparsing, slik at begge CLI-ene kan deles om
 * oppdagelse av testfiler og kjøring uten å duplisere konfigurasjon.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isTestFile } from "../test-mapping.mjs";

const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "coverage", "test-results"]);

function walk(directory, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, output);
    } else if (entry.isFile()) {
      output.push(absolute);
    }
  }
}

/** Alle Vitest-tester under `src`, som posix-stier relativt til repoet. */
export function listTestFiles(repositoryRoot) {
  const absoluteTests = [];
  walk(path.join(repositoryRoot, "src"), absoluteTests);
  return absoluteTests
    .map((absolute) => path.relative(repositoryRoot, absolute).split(path.sep).join("/"))
    .filter(isTestFile)
    .sort();
}

export function createFileAccess(repositoryRoot) {
  return {
    readFile(relativePath) {
      return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    },
    exists(relativePath) {
      return existsSync(path.join(repositoryRoot, relativePath));
    },
  };
}

/**
 * Kjør Vitest med eksplisitte filer. Vi bruker vitest.mjs direkte i stedet for
 * npx, slik at CI ikke trenger nettverk og vi er sikre på riktig versjon.
 */
export function runVitest({ repositoryRoot, tests, integration = false }) {
  const vitest = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");
  const args = [vitest, "run"];
  if (integration) {
    args.push("--config", "vitest.integration.config.ts");
  }
  args.push(...tests);

  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`Kunne ikke starte Vitest: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
