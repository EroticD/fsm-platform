#!/usr/bin/env node
/**
 * Kjør testene for én navngitt modul eller domene.
 *
 *   npm run test:module -- invoicing
 *   npm run test:module -- auth --integration
 *   npm run test:module -- api --list
 *
 * Modulene og nøkkelordene ligger i test-mapping.mjs, slik at `test:module`
 * og `test:changed` bruker samme definisjon av hva som hører til en modul.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import {
  MODULE_NAMES,
  MODULE_TARGETS,
  collectModuleTests,
  isIntegrationTest,
} from "./test-mapping.mjs";
import { createFileAccess, listTestFiles, runVitest } from "./lib/test-runner.mjs";

function usage() {
  const modules = MODULE_NAMES.map(
    (name) => `  ${name.padEnd(12)} ${MODULE_TARGETS[name].description}`,
  ).join("\n");
  return `Bruk: node scripts/test-module.mjs <modul> [valg]

Moduler:
${modules}

Valg:
  --integration   Kjør bare *.integration.test.ts
  --all           Kjør både enhets- og integrasjonstester
  --allow-empty   Lykkes med advarsel når modulen ikke har noen tester
  --list          Skriv ut testene uten å kjøre Vitest
  -h, --help      Vis denne hjelpen
`;
}

function parseArguments(argv) {
  const options = {
    moduleName: null,
    integration: false,
    all: false,
    allowEmpty: false,
    list: false,
    help: false,
  };

  for (const argument of argv) {
    if (argument === "--integration") {
      options.integration = true;
    } else if (argument === "--all") {
      options.all = true;
    } else if (argument === "--allow-empty") {
      options.allowEmpty = true;
    } else if (argument === "--list") {
      options.list = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`Ukjent argument: ${argument}`);
    } else if (options.moduleName) {
      throw new Error(`Bare én modul kan oppgis (fikk «${options.moduleName}» og «${argument}»).`);
    } else {
      options.moduleName = argument;
    }
  }

  if (options.integration && options.all) {
    throw new Error("--integration og --all kan ikke kombineres.");
  }
  return options;
}

function resolveRepositoryRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.moduleName) {
    console.error(usage());
    return 2;
  }

  const mode = options.all ? "all" : options.integration ? "integration" : "unit";
  const modeLabel = mode === "all" ? "tester" : mode === "integration" ? "integrasjonstester" : "enhetstester";
  const repositoryRoot = resolveRepositoryRoot();
  const { readFile } = createFileAccess(repositoryRoot);
  const result = collectModuleTests({
    moduleName: options.moduleName,
    testFiles: listTestFiles(repositoryRoot),
    readFile,
    mode,
  });

  if (!result) {
    console.error(`Ukjent modul «${options.moduleName}».`);
    console.error(`Gyldige moduler: ${MODULE_NAMES.join(", ")}`);
    return 2;
  }

  console.log(`Modul: ${options.moduleName} — ${result.target.description}`);
  console.log(`Mapper til ${result.tests.length} ${modeLabel}.`);

  if (result.tests.length === 0) {
    const message =
      `Ingen ${modeLabel} er knyttet til modulen «${options.moduleName}». ` +
      "Legg til en test, eller bruk --all for å se begge testtypene.";
    if (options.allowEmpty) {
      console.warn(`Advarsel: ${message}`);
      return 0;
    }
    console.error(`Feil: ${message}`);
    return 1;
  }

  for (const test of result.tests) console.log(`  → ${test}`);

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

  if (mode === "all") {
    const unitTests = result.tests.filter((test) => !isIntegrationTest(test));
    const integrationTests = result.tests.filter(isIntegrationTest);
    if (unitTests.length > 0) {
      console.log(`\nKjører ${unitTests.length} enhetstester med Vitest …`);
      const status = runVitest({ repositoryRoot, tests: unitTests, integration: false });
      if (status !== 0) return status;
    }
    if (integrationTests.length > 0) {
      if (!process.env.TEST_DATABASE_URL) {
        console.warn(
          "\nAdvarsel: TEST_DATABASE_URL er ikke satt. Integrasjonsoppsettet faller tilbake til DATABASE_URL; " +
            "bruk en dedikert testdatabase.",
        );
      }
      console.log(`\nKjører ${integrationTests.length} integrasjonstester med Vitest …`);
      return runVitest({ repositoryRoot, tests: integrationTests, integration: true });
    }
    return 0;
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
