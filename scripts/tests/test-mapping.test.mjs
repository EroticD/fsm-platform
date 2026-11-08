import assert from "node:assert/strict";
import test from "node:test";
import {
  DOMAIN_KEYWORDS,
  MODULE_NAMES,
  collectModuleTests,
  domainsForPath,
  extractImportSpecifiers,
  findRouteTests,
  findSiblingTests,
  isSourceFile,
  mapChangedFilesToTests,
  modeMatches,
  resolveImportPath,
} from "../test-mapping.mjs";

function fixture({ tests, contents = {}, existing = [] }) {
  const contentMap = new Map(Object.entries(contents));
  const existingSet = new Set(existing);
  return {
    testFiles: tests,
    readFile: (file) => contentMap.get(file) ?? "",
    exists: (file) => existingSet.has(file),
  };
}

test("finner direkte søskentester, også kvalifiserte varianter", () => {
  const testFiles = [
    "src/lib/foo.test.ts",
    "src/lib/foo.integration.test.ts",
    "src/lib/foo.export.test.ts",
    "src/lib/foo-validation.test.ts",
    "src/lib/bar.test.ts",
  ];
  assert.deepEqual(findSiblingTests("src/lib/foo.ts", testFiles), [
    "src/lib/foo.test.ts",
    "src/lib/foo.integration.test.ts",
    "src/lib/foo.export.test.ts",
    "src/lib/foo-validation.test.ts",
  ]);
});

test("finner tester i samme rute-/sidemappe", () => {
  const testFiles = [
    "src/app/oppdrag/page.test.ts",
    "src/app/oppdrag/actions.test.ts",
    "src/app/oppdrag/[id]/page.test.ts",
  ];
  assert.deepEqual(findRouteTests("src/app/oppdrag/page.tsx", testFiles), [
    "src/app/oppdrag/page.test.ts",
    "src/app/oppdrag/actions.test.ts",
  ]);
});

test("klassifiserer kilde- og testfiler uten å ta med typer eller testhjelpere", () => {
  assert.equal(isSourceFile("src/lib/foo.ts"), true);
  assert.equal(isSourceFile("src/lib/foo.test.ts"), false);
  assert.equal(isSourceFile("src/lib/foo.d.ts"), false);
  assert.equal(isSourceFile("prisma/schema.prisma"), false);
  assert.equal(modeMatches("src/lib/foo.test.ts", "unit"), true);
  assert.equal(modeMatches("src/lib/foo.integration.test.ts", "unit"), false);
  assert.equal(modeMatches("src/lib/foo.integration.test.ts", "integration"), true);
});

test("leser import, eksport, require, dynamisk import og vi.mock", () => {
  const content = `
    import { a } from "@/server/a";
    import type { B } from "./b";
    export { c } from "../c";
    const d = require("../../d");
    const e = await import("@/lib/e");
    vi.mock("@/lib/f", () => ({}));
  `;
  assert.deepEqual(extractImportSpecifiers(content).sort(), [
    "../../d",
    "../c",
    "./b",
    "@/lib/e",
    "@/lib/f",
    "@/server/a",
  ]);
});

test("løser alias, relative stier, index og .js til .ts", () => {
  const existing = new Set([
    "src/lib/foo.ts",
    "src/lib/bar/index.ts",
    "src/lib/baz.ts",
  ]);
  const exists = (file) => existing.has(file);
  assert.equal(resolveImportPath("@/lib/foo", "src/app/page.test.ts", exists), "src/lib/foo.ts");
  assert.equal(resolveImportPath("../lib/foo", "src/app/page.test.ts", exists), "src/lib/foo.ts");
  assert.equal(resolveImportPath("@/lib/bar", "src/app/page.test.ts", exists), "src/lib/bar/index.ts");
  assert.equal(resolveImportPath("./baz.js", "src/lib/other.test.ts", exists), "src/lib/baz.ts");
  assert.equal(resolveImportPath("next/navigation", "src/app/page.test.ts", exists), null);
});

test("reverse imports finner både import og vi.mock", () => {
  const { testFiles, readFile, exists } = fixture({
    tests: [
      "src/lib/billing.test.ts",
      "src/server/other.test.ts",
      "src/server/integration/quotes-invoicing.integration.test.ts",
    ],
    contents: {
      "src/lib/billing.test.ts": `vi.mock("@/server/invoices", () => ({}));`,
      "src/server/other.test.ts": `import { createInvoice } from "./invoices";`,
      "src/server/integration/quotes-invoicing.integration.test.ts": `import { createInvoice } from "@/server/invoices";`,
    },
    existing: ["src/server/invoices.ts"],
  });

  const unit = mapChangedFilesToTests({
    changedFiles: ["src/server/invoices.ts"],
    testFiles,
    readFile,
    exists,
    mode: "unit",
  });
  assert.ok(unit.tests.includes("src/lib/billing.test.ts"));
  assert.ok(unit.tests.includes("src/server/other.test.ts"));
  assert.ok(!unit.tests.includes("src/server/integration/quotes-invoicing.integration.test.ts"));

  const integration = mapChangedFilesToTests({
    changedFiles: ["src/server/invoices.ts"],
    testFiles,
    readFile,
    exists,
    mode: "integration",
  });
  assert.ok(integration.tests.includes("src/server/integration/quotes-invoicing.integration.test.ts"));
});

test("domenefallback kobler faktura til billing, payment og integrasjonsinnhold", () => {
  const { testFiles, readFile } = fixture({
    tests: [
      "src/lib/billing.test.ts",
      "src/server/integration/payments-accounting.integration.test.ts",
      "src/server/integration/notes.integration.test.ts",
      "src/lib/unrelated.test.ts",
    ],
    contents: {
      "src/server/integration/notes.integration.test.ts":
        "// Denne testen dekker invoices og kreditnota.",
    },
  });

  const result = mapChangedFilesToTests({
    changedFiles: ["src/server/invoices.ts"],
    testFiles,
    readFile,
    exists: () => false,
    mode: "integration",
  });

  assert.ok(result.tests.includes("src/server/integration/payments-accounting.integration.test.ts"));
  assert.ok(result.tests.includes("src/server/integration/notes.integration.test.ts"));
  assert.ok(!result.tests.includes("src/lib/unrelated.test.ts"));
  assert.deepEqual(result.unmatchedSources, []);
});

test("delt token fanger søstermoduler uten eksplisitt domenealias", () => {
  const result = mapChangedFilesToTests({
    changedFiles: ["src/lib/job-worker.ts"],
    testFiles: ["src/lib/job-queue.test.ts", "src/lib/dates.test.ts"],
    readFile: () => "",
    exists: () => false,
    mode: "unit",
  });
  assert.deepEqual(result.tests, ["src/lib/job-queue.test.ts"]);
});

test("endrede testfiler tas med, og feil modus rapporteres som hoppet over", () => {
  const result = mapChangedFilesToTests({
    changedFiles: ["src/lib/foo.test.ts", "src/lib/bar.integration.test.ts"],
    testFiles: ["src/lib/foo.test.ts", "src/lib/bar.integration.test.ts"],
    readFile: () => "",
    exists: () => false,
    mode: "unit",
  });
  assert.deepEqual(result.tests, ["src/lib/foo.test.ts"]);
  assert.deepEqual(result.skippedTests, ["src/lib/bar.integration.test.ts"]);
});

test("skjemaendring kjører hele suiten i valgt modus", () => {
  const result = mapChangedFilesToTests({
    changedFiles: ["prisma/schema.prisma"],
    testFiles: [
      "src/lib/foo.test.ts",
      "src/lib/bar.integration.test.ts",
    ],
    readFile: () => "",
    exists: () => false,
    mode: "unit",
  });
  assert.equal(result.forcedAll, true);
  assert.deepEqual(result.tests, ["src/lib/foo.test.ts"]);
  assert.deepEqual(result.unmatchedSources, []);
});

test("rapporterer kildefil uten test i stedet for å late som alt er dekket", () => {
  const result = mapChangedFilesToTests({
    changedFiles: ["src/lib/helt-ny.ts"],
    testFiles: ["src/lib/annet.test.ts"],
    readFile: () => "",
    exists: () => false,
    mode: "unit",
  });
  assert.deepEqual(result.tests, []);
  assert.deepEqual(result.unmatchedSources, ["src/lib/helt-ny.ts"]);
});

test("brede rbac-ord gir ikke innholdstreff på hele integrasjonssuiten", () => {
  const { testFiles, readFile } = fixture({
    tests: [
      "src/server/integration/field-rbac.integration.test.ts",
      "src/server/integration/sso-scim.integration.test.ts",
    ],
    contents: {
      "src/server/integration/field-rbac.integration.test.ts":
        "// field policy og access for roller",
      "src/server/integration/sso-scim.integration.test.ts":
        "// access og role via SCIM",
    },
  });

  const result = mapChangedFilesToTests({
    changedFiles: ["src/components/settings/FieldPolicyMatrix.tsx"],
    testFiles,
    readFile,
    exists: () => false,
    mode: "integration",
  });

  assert.deepEqual(result.tests, ["src/server/integration/field-rbac.integration.test.ts"]);
});

test("domenekatalog har nøkkelord for alle navngitte moduler", () => {
  for (const name of MODULE_NAMES) {
    assert.ok(DOMAIN_KEYWORDS[name] || name === "mobile-api", `mangler nøkkelord for ${name}`);
  }
  for (const required of [
    "quotes",
    "invoicing",
    "inventory",
    "expenses",
    "bi",
    "routing",
    "auth",
    "rbac",
    "payments",
    "accounting",
    "email",
    "push",
    "api",
    "core",
    "mobile-api",
  ]) {
    assert.ok(MODULE_NAMES.includes(required), `mangler modul ${required}`);
  }
});

test("test:module velger enhets- og integrasjonstester fra samme definisjon", () => {
  const testFiles = [
    "src/lib/billing.test.ts",
    "src/lib/payments/payments.test.ts",
    "src/lib/quotes-scope.test.ts",
    "src/server/integration/quotes-invoicing.integration.test.ts",
    "src/server/integration/payments-accounting.integration.test.ts",
    "src/server/integration/inventory-expenses.integration.test.ts",
  ];

  const invoicing = collectModuleTests({
    moduleName: "invoicing",
    testFiles,
    mode: "unit",
  });
  assert.ok(invoicing.tests.includes("src/lib/billing.test.ts"));
  assert.ok(!invoicing.tests.includes("src/server/integration/quotes-invoicing.integration.test.ts"));

  const all = collectModuleTests({
    moduleName: "invoicing",
    testFiles,
    mode: "all",
  });
  assert.ok(all.tests.includes("src/server/integration/quotes-invoicing.integration.test.ts"));
  assert.ok(all.tests.includes("src/server/integration/payments-accounting.integration.test.ts"));

  const quotes = collectModuleTests({
    moduleName: "quotes",
    testFiles,
    mode: "all",
  });
  assert.deepEqual(quotes.tests, [
    "src/lib/quotes-scope.test.ts",
    "src/server/integration/quotes-invoicing.integration.test.ts",
  ]);

  assert.equal(collectModuleTests({ moduleName: "finnes-ikke", testFiles }), null);
});

test("mobile-api og push deler push-testene, men ikke hele API-suiten", () => {
  const testFiles = [
    "src/app/api/mobile/push-tokens/route.test.ts",
    "src/server/push.test.ts",
    "src/app/api/v1/work-orders/route.test.ts",
  ];
  const mobile = collectModuleTests({ moduleName: "mobile-api", testFiles, mode: "unit" });
  assert.ok(mobile.tests.includes("src/server/push.test.ts"));
  assert.ok(mobile.tests.includes("src/app/api/mobile/push-tokens/route.test.ts"));
  assert.ok(!mobile.tests.includes("src/app/api/v1/work-orders/route.test.ts"));
});

test("path-domeneoverstyring hindrer at mobile-API drar inn hele API-suiten", () => {
  assert.deepEqual(domainsForPath("src/app/api/mobile/push-tokens/route.ts"), ["mobile"]);
  // api er bevisst ikke domenefallback for enkeltfiler; test:module api dekker
  // hele API-flaten når man faktisk vil kjøre den.
  assert.deepEqual(domainsForPath("src/app/api/v1/work-orders/route.ts"), []);
  assert.ok(domainsForPath("src/server/invoices.ts").includes("invoicing"));
});
