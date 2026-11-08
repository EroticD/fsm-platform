#!/usr/bin/env node
/**
 * Kjør bare Vitest-testene som berøres av endringene på grenen.
 *
 * Eksempler:
 *   npm run test:changed
 *   npm run test:changed -- --base origin/dev
 *   npm run test:changed:integration -- --base HEAD~1
 *   node scripts/test-changed.mjs --base HEAD~1 --list
 *
 * Standard base er `origin/dev`, deretter `HEAD~1`. I GitHub Actions brukes
 * `GITHUB_BASE_REF` (som `origin/<branch>`) og `GITHUB_SHA` når de finnes.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { mapChangedFilesToTests } from "./test-mapping.mjs";
import { createFileAccess, listTestFiles, runVitest } from "./lib/test-runner.mjs";

const REASON_LABELS = {
  "changed-test": "endret testfil",
  sibling: "direkte søskentest",
  route: "test i samme rute-/sidemappe",
  import: "importerer/mocker endret modul",
  "force-all": "test- eller skjemaoppsett er endret",
};

function describeReason(reason) {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  if (reason.startsWith("token:")) return `delt token «${reason.slice(6)}»`;
  if (reason.startsWith("domain-content:")) return `domenefallback i innhold (${reason.slice(15)})`;
  if (reason.startsWith("domain:")) return `domenefallback (${reason.slice(7)})`;
  return reason;
}

function usage() {
  return `Bruk: node scripts/test-changed.mjs [valg]

Valg:
  --base <ref>        Sammenlign mot denne refen (standard: origin/dev, så HEAD~1)
  --head <ref>        Sammenlign til denne refen (standard: GITHUB_SHA, så HEAD)
  --integration       Kjør bare *.integration.test.ts med integrasjonskonfigurasjonen
  --allow-empty       Lykkes med advarsel når endret kildekode ikke har noen test
  --list              Skriv ut mappingen uten å kjøre Vitest
  -h, --help          Vis denne hjelpen

Miljø:
  GITHUB_BASE_REF     Base-branch i pull requests (brukes som origin/<ref>)
  GITHUB_SHA          Head-commit i GitHub Actions
  TEST_DATABASE_URL   Peker integrasjonstestene mot en trygg testdatabase
`;
}

function parseArguments(argv) {
  const options = {
    base: null,
    head: null,
    integration: false,
    allowEmpty: false,
    list: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--integration") {
      options.integration = true;
    } else if (argument === "--allow-empty") {
      options.allowEmpty = true;
    } else if (argument === "--list") {
      options.list = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--base" || argument.startsWith("--base=")) {
      const value = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : argv[++index];
      if (!value) throw new Error("--base krever en git-ref");
      options.base = value;
    } else if (argument === "--head" || argument.startsWith("--head=")) {
      const value = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : argv[++index];
      if (!value) throw new Error("--head krever en git-ref");
      options.head = value;
    } else {
      throw new Error(`Ukjent argument: ${argument}`);
    }
  }
  return options;
}

function git(repositoryRoot, argumentsList) {
  return execFileSync("git", argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function refExists(repositoryRoot, ref) {
  try {
    git(repositoryRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function sameCommit(repositoryRoot, left, right) {
  try {
    return git(repositoryRoot, ["rev-parse", left]) === git(repositoryRoot, ["rev-parse", right]);
  } catch {
    return false;
  }
}

function resolveRepositoryRoot() {
  return git(process.cwd(), ["rev-parse", "--show-toplevel"]);
}

function resolveBase(repositoryRoot, explicitBase, head) {
  if (explicitBase) {
    if (!refExists(repositoryRoot, explicitBase)) {
      throw new Error(`Fant ikke base-refen «${explicitBase}». Hent historikken (git fetch) eller oppgi --base.`);
    }
    return explicitBase;
  }

  const candidates = [];
  if (process.env.GITHUB_BASE_REF) candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
  candidates.push("origin/dev", "HEAD~1");

  // På en push til dev peker origin/dev på samme commit som HEAD. Da er
  // HEAD~1 riktig sammenligningspunkt; ellers ville diffen alltid vært tom.
  const base = candidates.find(
    (candidate) => refExists(repositoryRoot, candidate) && !sameCommit(repositoryRoot, candidate, head),
  );
  if (!base) {
    throw new Error("Fant ingen base-ref (origin/dev eller HEAD~1). Oppgi --base <ref>.");
  }
  return base;
}

function resolveHead(repositoryRoot, explicitHead) {
  if (explicitHead) {
    if (!refExists(repositoryRoot, explicitHead)) {
      throw new Error(`Fant ikke head-refen «${explicitHead}».`);
    }
    return explicitHead;
  }
  if (process.env.GITHUB_SHA && refExists(repositoryRoot, process.env.GITHUB_SHA)) {
    return process.env.GITHUB_SHA;
  }
  return "HEAD";
}

function readWorkingTreeFiles(repositoryRoot) {
  const files = new Set();
  for (const argumentsList of [
    ["diff", "--name-only", "--diff-filter=ACMR", "--find-renames"],
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--find-renames"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const output = git(repositoryRoot, argumentsList);
    if (!output) continue;
    for (const file of output.split("\n")) {
      if (file.trim()) files.add(file.trim());
    }
  }
  return [...files];
}

function readChangedFiles(repositoryRoot, base, head) {
  const range = `${base}...${head}`;
  try {
    const output = git(repositoryRoot, [
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      "--find-renames",
      range,
    ]);
    const files = new Set(output ? output.split("\n").map((file) => file.trim()).filter(Boolean) : []);
    // Lokal kjøring skal også se ulagrede og nye filer. I CI er treet rent.
    if (head === "HEAD") {
      for (const file of readWorkingTreeFiles(repositoryRoot)) files.add(file);
    }
    return [...files];
  } catch (error) {
    throw new Error(`Kunne ikke lese git-diff for ${range}: ${error.message}`);
  }
}

function printMapping(result) {
  const bySource = new Map();
  const changedTestMatches = [];
  let forced = false;

  for (const match of result.matches) {
    if (match.source === null) {
      changedTestMatches.push(match);
      continue;
    }
    if (match.source === "*") {
      forced = true;
      continue;
    }
    if (!bySource.has(match.source)) bySource.set(match.source, []);
    bySource.get(match.source).push(match);
  }

  if (changedTestMatches.length > 0) {
    console.log("\nEndrede testfiler:");
    for (const match of changedTestMatches) {
      console.log(`  → ${match.test}`);
    }
  }

  if (bySource.size > 0) {
    console.log("\nEndrede kildefiler og testene de mapper til:");
    for (const [source, matches] of bySource) {
      console.log(`\n  ${source}`);
      for (const match of matches) {
        console.log(`    → ${match.test} (${describeReason(match.reason)})`);
      }
    }
  }

  if (forced) {
    console.log("\nTest- eller skjemaoppsett er endret; hele suiten i valgt modus kjøres.");
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const repositoryRoot = resolveRepositoryRoot();
  const head = resolveHead(repositoryRoot, options.head);
  const base = resolveBase(repositoryRoot, options.base, head);
  const changedFiles = readChangedFiles(repositoryRoot, base, head);
  const mode = options.integration ? "integration" : "unit";
  const modeLabel = mode === "integration" ? "integrasjonstester" : "enhetstester";

  console.log(`Endringer: ${base}...${head}`);
  console.log(`Changed files: ${changedFiles.length}`);

  if (changedFiles.length === 0) {
    console.log("Ingen endrede filer i diffen. Ingenting å teste.");
    return 0;
  }

  const testFiles = listTestFiles(repositoryRoot);
  const { readFile, exists } = createFileAccess(repositoryRoot);
  const result = mapChangedFilesToTests({
    changedFiles,
    testFiles,
    readFile,
    exists,
    mode,
  });
  // Brukes bare til å skille «ingen test i det hele tatt» fra «testen ligger i
  // den andre testtypen», slik at unit- og integrasjonssteget i CI ikke
  // blokkerer hverandre.
  const allModeResult = mapChangedFilesToTests({
    changedFiles,
    testFiles,
    readFile,
    exists,
    mode: "all",
  });
  const coveredInOtherMode = new Set(
    allModeResult.matches
      .map((match) => match.source)
      .filter((source) => source && source !== "*"),
  );
  const unmatchedSources = result.unmatchedSources.filter(
    (source) => !coveredInOtherMode.has(source),
  );

  console.log(`Endrede kildefiler: ${result.changedSources.length}`);
  console.log(`Endrede testfiler: ${result.changedTests.length}`);
  console.log(`Mapper til ${result.tests.length} ${modeLabel}.`);

  printMapping(result);

  if (result.skippedTests.length > 0) {
    const otherMode = mode === "unit" ? "integrasjonstester" : "enhetstester";
    console.log(
      `\nMerk: ${result.skippedTests.length} endrede ${otherMode} hoppes over i denne modusen. ` +
        `Kjør ${mode === "unit" ? "npm run test:changed:integration" : "npm run test:changed"}.`,
    );
  }

  if (result.ignoredChanged.length > 0) {
    console.log(
      `\nIkke-kode endringer uten Vitest-mapping (${result.ignoredChanged.length}): ` +
        result.ignoredChanged.slice(0, 8).join(", ") +
        (result.ignoredChanged.length > 8 ? " …" : ""),
    );
  }

  if (unmatchedSources.length > 0) {
    console.warn("\nAdvarsel: disse endrede kildefilene har ingen mappet test:");
    for (const source of unmatchedSources) console.warn(`  - ${source}`);
    console.warn(
      "Legg til en søskentest, eller kjør hele suiten med npm test / npm run test:integration.",
    );
  }

  if (result.tests.length === 0) {
    if (result.changedSources.length === 0 && result.changedTests.length === 0) {
      console.log("Ingen kilde- eller testendringer krever Vitest. OK.");
      return 0;
    }
    if (allModeResult.tests.length > 0) {
      const otherMode =
        mode === "unit" ? "integrasjonstester (npm run test:changed:integration)" : "enhetstester (npm run test:changed)";
      console.log(
        `Testene som matcher er ${otherMode}. Den modusen kjøres separat; ingenting å gjøre her.`,
      );
      return 0;
    }
    const message =
      "Ingen tester matchet de endrede filene. Dette er ikke en grønn testkjøring. " +
      "Bruk --allow-empty bare når endringen bevisst ikke krever test (for eksempel ren UI-tekst), " +
      "ellers legg til en test eller kjør hele suiten.";
    if (options.allowEmpty) {
      console.warn(`\nAdvarsel: ${message}`);
      return 0;
    }
    console.error(`\nFeil: ${message}`);
    return 1;
  }

  if (options.list) {
    console.log("\n--list: kjører ikke Vitest.");
    return 0;
  }

  if (mode === "integration" && !process.env.TEST_DATABASE_URL) {
    console.warn(
      "\nAdvarsel: TEST_DATABASE_URL er ikke satt. Integrasjonsoppsettet faller tilbake til DATABASE_URL; " +
        "bruk en dedikert testdatabase.",
    );
  }

  console.log(`\nKjører ${result.tests.length} ${modeLabel} med Vitest …`);
  return runVitest({
    repositoryRoot,
    tests: result.tests,
    integration: mode === "integration",
  });
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`\nFeil: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
