/**
 * Ren logikk for å koble endrede kildefiler til Vitest-tester.
 *
 * Modulen har ingen sideeffekter og brukes både av `test-changed.mjs`,
 * `test-module.mjs` og enhetstestene i `scripts/tests`. Alt arbeid med git,
 * filsystem og Vitest ligger i CLI-skriptene, slik at reglene kan testes uten
 * database, nettverk eller en faktisk diff.
 */

import path from "node:path";

const TEST_SUFFIX = /\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const INTEGRATION_SUFFIX = /\.integration\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SOURCE_SUFFIX = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

/** Filer som gjør at hele testsuiten må kjøres i valgt modus. */
const FORCE_ALL_PATTERNS = [
  /^package-lock\.json$/,
  /^vitest\.config\.ts$/,
  /^vitest\.integration\.config\.ts$/,
  /^tsconfig\.json$/,
  /^next\.config\.ts$/,
  /^src\/test\//,
  /^prisma\//,
  /\.sql$/,
];

/**
 * Nøkkelord per domene. De brukes både til domenefallback for endrede filer
 * og til `npm run test:module <navn>`.
 *
 * Rekkefølgen er ikke viktig for resultatet, men holdes lik modullisten i
 * dokumentasjonen. Korte nøkkelord (bi, api, hms) matches bare som hele ord.
 */
export const DOMAIN_KEYWORDS = {
  quotes: ["quote", "quotes", "tilbud", "offer", "tilbudsbrev"],
  invoicing: [
    "invoice",
    "invoices",
    "invoicing",
    "billing",
    "faktura",
    "payment",
    "payments",
    "credit",
    "kreditnota",
    "mva",
    "vat",
  ],
  inventory: [
    "inventory",
    "lager",
    "stock",
    "purchasing",
    "purchase",
    "supplier",
    "leverandor",
    "innkjop",
    "reservation",
    "reservasjon",
  ],
  expenses: ["expense", "expenses", "utlegg", "payroll", "lonn", "reise"],
  bi: ["bi", "lonnsomhet", "profitability", "revenue", "inntekt", "margin"],
  routing: [
    "routing",
    "route",
    "rute",
    "ruteoptimalisering",
    "osrm",
    "traffic",
    "trafikk",
    "dispatch",
    "kapasitet",
    "capacity",
  ],
  auth: [
    "auth",
    "authentication",
    "login",
    "logg-inn",
    "session",
    "sesjon",
    "sso",
    "saml",
    "scim",
    "two-factor",
    "2fa",
    "mfa",
    "password",
    "passord",
    "credential",
    "credentials",
    "security",
    "sikkerhet",
  ],
  rbac: [
    "rbac",
    "access",
    "tilgang",
    "permission",
    "permissions",
    "role",
    "rolle",
    "policy",
    "field-rbac",
    "feltpolicy",
  ],
  payments: ["payment", "payments", "betaling", "vipps", "stripe", "webhook"],
  accounting: ["accounting", "regnskap", "fiken", "tripletex", "poweroffice", "voucher", "bilag"],
  email: ["email", "e-post", "epost", "smtp", "outbox", "mail", "utsending"],
  push: ["push", "notification", "varsel", "fcm", "apns", "mobilvarsel"],
  api: ["api", "openapi", "contract", "kontrakt", "scim", "webhook", "endpoint"],
  mobile: ["mobile", "mobil", "push-token", "push-tokens", "push"],
  core: [
    "core",
    "customer",
    "kunde",
    "contact",
    "kontakt",
    "site",
    "sted",
    "work-order",
    "work-orders",
    "oppdrag",
    "visit",
    "visits",
    "besok",
    "workday",
    "work-day",
    "arbeidsdag",
    "workforce",
    "user",
    "users",
    "bruker",
    "settings",
    "innstilling",
    "audit",
    "revisjon",
    "module",
    "modules",
    "modul",
    "notification",
    "calendar",
    "kalender",
    "document",
    "documents",
    "dokument",
    "portal",
    "kundeportal",
    "contract",
    "contracts",
    "avtale",
    "sla",
    "equipment",
    "enhet",
    "hms",
    "report",
    "reports",
    "rapport",
    "sms",
    "message",
    "messages",
    "melding",
    "tracking",
    "sporing",
    "map",
    "maps",
    "kart",
    "search",
    "sok",
    "navigation",
    "navigasjon",
    "job",
    "worker",
    "queue",
    "realtime",
    "sanntid",
  ],
};

/**
 * Innholdssøk er bare for integrasjonstester og bare for domener der innholdet
 * faktisk sier noe presist om domenet. Ord som «access» eller «role» ville
 * ellers truffet nesten alle integrasjonstestene.
 */
export const DOMAIN_CONTENT_KEYWORDS = {
  quotes: ["quote", "quotes", "tilbud"],
  invoicing: ["invoice", "invoices", "invoicing", "faktura", "credit", "kreditnota", "payment", "payments"],
  inventory: ["inventory", "lager", "purchasing", "purchase", "supplier", "innkjop"],
  expenses: ["expense", "expenses", "utlegg", "payroll"],
  bi: ["lonnsomhet", "profitability"],
  accounting: ["accounting", "regnskap", "fiken", "tripletex", "poweroffice"],
  payments: ["payment", "payments", "vipps", "stripe", "webhook"],
};

/**
 * Kjerne- og API-domenene brukes av `test:module`, men er for brede som
 * automatisk fallback for en enkelt endret fil. Der holder det med direkte
 * søskentest, reverse imports og delte tokens; ellers ville en liten
 * innstillingskomponent dratt inn nesten hele suiten.
 */
const FALLBACK_DOMAIN_EXCLUDE = new Set(["core", "api"]);

/**
 * Stier der et generelt ord som «api» ellers ville dratt inn hele API-suiten.
 * Overstyringen gjelder bare valg av domene for endrede kildefiler.
 */
const PATH_DOMAIN_OVERRIDES = [
  { pattern: /^src\/app\/api\/mobile\//, domains: ["mobile"] },
  { pattern: /^src\/app\/api\/v1\//, domains: ["api"] },
  { pattern: /^src\/app\/api\/webhooks\/payments\//, domains: ["payments"] },
  { pattern: /^src\/lib\/payments\//, domains: ["payments"] },
  { pattern: /^src\/lib\/accounting\//, domains: ["accounting"] },
  { pattern: /^src\/lib\/routing\//, domains: ["routing"] },
  { pattern: /^src\/lib\/email/, domains: ["email"] },
  { pattern: /^src\/lib\/push/, domains: ["push"] },
];

/**
 * Navngitte moduler/domener for `npm run test:module <navn>`.
 * `domains` peker på nøkkelordene over, mens `paths` fanger opp filer som
 * ikke inneholder domenenavnet (for eksempel mobile-API-ruten).
 */
export const MODULE_TARGETS = {
  quotes: {
    description: "Tilbud, portal-godkjenning og konvertering",
    domains: ["quotes"],
    paths: [/^src\/app\/tilbud\//, /^src\/server\/quotes/],
  },
  invoicing: {
    description: "Fakturering, betaling, kreditnota og CSV",
    domains: ["invoicing"],
    paths: [/^src\/app\/faktura\//, /^src\/server\/invoices/],
  },
  inventory: {
    description: "Lager, reservasjon/forbruk, leverandør og innkjøp",
    domains: ["inventory"],
    paths: [/^src\/app\/lager\//, /^src\/server\/inventory/, /^src\/server\/purchasing/],
  },
  expenses: {
    description: "Kjøring/utlegg, godkjenning og lønn-CSV",
    domains: ["expenses"],
    paths: [/^src\/app\/utlegg\//, /^src\/server\/expenses/],
  },
  bi: {
    description: "Lønnsomhet, estimert/ faktisk inntekt og CSV",
    domains: ["bi"],
    paths: [/^src\/app\/lonnsomhet\//, /^src\/server\/bi/],
  },
  routing: {
    description: "Ruteplan, optimalisering, trafikk og dispatch",
    domains: ["routing"],
    paths: [
      /^src\/lib\/routing\//,
      /^src\/server\/(?:route-plan|dispatch)/,
      /^src\/app\/kalender\/(?:rute|dispatch)/,
      /^src\/app\/api\/ruteoptimalisering\//,
    ],
  },
  auth: {
    description: "Innlogging, sesjon, SSO/SAML, 2FA og passord",
    domains: ["auth"],
    paths: [
      /^src\/app\/(?:logg-inn|glemt-passord|tilbakestill-passord|aktiver-konto|sikkerhet)\//,
      /^src\/(?:lib|server)\/(?:auth|sso|saml|scim|session|two-factor|password|credentials|security)/,
    ],
  },
  rbac: {
    description: "Tilgangskontroll, roller, feltpolicy og permissions",
    domains: ["rbac"],
    paths: [
      /^src\/lib\/(?:access|permissions|role)/,
      /^src\/server\/integration\/field-rbac/,
      /^src\/app\/innstillinger\/(?:role|calendar)/,
    ],
  },
  payments: {
    description: "Betalingsleverandører, webhooks og validering",
    domains: ["payments"],
    paths: [/^src\/(?:lib|server)\/payments/, /^src\/app\/api\/webhooks\/payments\//],
  },
  accounting: {
    description: "Regnskapsleverandører, bilag og synkronisering",
    domains: ["accounting"],
    paths: [/^src\/lib\/accounting\//, /^src\/server\/accounting/],
  },
  email: {
    description: "E-postmaler, SMTP og outbox",
    domains: ["email"],
    paths: [/^src\/lib\/(?:email|mail)/, /^src\/server\/email/],
  },
  push: {
    description: "Push, varsler og enhetsregistrering",
    domains: ["push"],
    paths: [/^src\/(?:lib|server)\/push/, /^src\/app\/api\/mobile\//],
  },
  api: {
    description: "REST-API, OpenAPI, API-nøkler og webhooks",
    domains: ["api"],
    paths: [/^src\/app\/api\//, /^src\/lib\/api-/],
  },
  core: {
    description: "Kjerne: kunder, oppdrag, brukere, innstillinger og revisjon",
    domains: ["core"],
    paths: [],
  },
  "mobile-api": {
    description: "Mobil-API (push-tokens og mobilklientens endepunkter)",
    domains: ["mobile"],
    paths: [/^src\/app\/api\/mobile\//, /^src\/server\/push/, /^src\/lib\/push/],
  },
};

/** Ord som går igjen i alle stier og derfor ikke sier noe om domenet. */
const GENERIC_PATH_TOKENS = new Set([
  "src",
  "app",
  "lib",
  "server",
  "components",
  "component",
  "api",
  "test",
  "tests",
  "integration",
  "unit",
  "page",
  "layout",
  "route",
  "routes",
  "actions",
  "action",
  "index",
  "types",
  "type",
  "utils",
  "util",
  "hooks",
  "hook",
  "config",
  "constants",
  "helpers",
  "helper",
  "provider",
  "providers",
  "shared",
  "common",
  "v1",
]);

/**
 * Nøkkelordene er skrevet for lesbarhet, men sammenlignes som tokens.
 * «logg-inn» og «two-factor» må derfor matche to påfølgende token.
 */
function tokenize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function tokenMatchesToken(token, keyword) {
  if (token === keyword) return true;
  // Korte nøkkelord som «bi» og «api» skal ikke matche «billing» eller «apis».
  return keyword.length >= 4 && token.startsWith(keyword);
}

function pathMatchesKeyword(path, keyword) {
  const tokens = tokenize(path);
  const parts = tokenize(keyword);
  if (parts.length === 1) {
    return tokens.some((token) => tokenMatchesToken(token, parts[0]));
  }
  return tokens.some((_, index) =>
    parts.every((part, offset) => {
      const token = tokens[index + offset];
      return token ? tokenMatchesToken(token, part) : false;
    }),
  );
}

function pathMatchesAnyKeyword(path, keywords) {
  return keywords.some((keyword) => pathMatchesKeyword(path, keyword));
}

function contentMatchesAnyKeyword(content, keywords) {
  return keywords.some((keyword) => {
    const parts = tokenize(keyword);
    // Innholdssøk er bare for integrations tester og bare for tydelige ord.
    if (parts.join("").length < 5) return false;
    const pattern = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_-]*");
    return new RegExp(`\\b${pattern}`, "i").test(content);
  });
}

function meaningfulTokens(path) {
  return tokenize(path).filter(
    (token) => token.length > 2 && !GENERIC_PATH_TOKENS.has(token),
  );
}

function tokensShare(left, right) {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function toPosix(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isTestFile(path) {
  return TEST_SUFFIX.test(toPosix(path));
}

export function isIntegrationTest(path) {
  return INTEGRATION_SUFFIX.test(toPosix(path));
}

export function isSourceFile(path) {
  const file = toPosix(path);
  return (
    file.startsWith("src/") &&
    SOURCE_SUFFIX.test(file) &&
    !TEST_SUFFIX.test(file) &&
    !/\.d\.(?:ts|mts)$/.test(file)
  );
}

export function modeMatches(path, mode) {
  if (!isTestFile(path)) return false;
  if (mode === "all") return true;
  if (mode === "integration") return isIntegrationTest(path);
  return !isIntegrationTest(path);
}

export function extractImportSpecifiers(content) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:require|import|vi\.mock|vi\.doMock|vi\.unmock)\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/**
 * Løser en importspecifier fra en testfil til en sti i repoet.
 * `exists` injiseres slik at funksjonen kan testes uten filsystem.
 */
export function resolveImportPath(specifier, fromFile, exists) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : path.posix.normalize(path.posix.join(path.posix.dirname(toPosix(fromFile)), specifier));
  const normalized = toPosix(base).replace(/^\/+/, "").replace(/[?#].*$/, "");

  const candidates = [normalized];
  if (/\.(?:js|jsx|mjs|cjs)$/.test(normalized)) {
    const without = normalized.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
    candidates.push(`${without}.ts`, `${without}.tsx`, `${without}.mts`);
  }
  for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    candidates.push(`${normalized}${extension}`);
  }
  for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    candidates.push(`${normalized}/index${extension}`);
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Finn tester i samme mappe som en endret kildefil. I tillegg til
 * `foo.test.ts` tas kvalifiserte varianter som `foo.export.test.ts` og
 * `foo-validation.test.ts` med, fordi repoet bruker dem for større moduler.
 */
export function findSiblingTests(sourcePath, testFiles) {
  const source = toPosix(sourcePath);
  if (isTestFile(source)) return [];
  const directory = source.slice(0, source.lastIndexOf("/"));
  const filename = source.slice(source.lastIndexOf("/") + 1);
  const stem = filename.replace(SOURCE_SUFFIX, "");

  return testFiles
    .map(toPosix)
    .filter((test) => {
      if (test.slice(0, test.lastIndexOf("/")) !== directory) return false;
      const name = test.slice(test.lastIndexOf("/") + 1);
      if (!name.startsWith(stem)) return false;
      const rest = name.slice(stem.length);
      return (rest.startsWith(".") || rest.startsWith("-")) && isTestFile(name);
    });
}

/** Alle tester i samme rute-/sidemappe, uavhengig av filnavn. */
export function findRouteTests(sourcePath, testFiles) {
  const source = toPosix(sourcePath);
  if (!source.startsWith("src/app/") || isTestFile(source)) return [];
  const directory = source.slice(0, source.lastIndexOf("/"));
  return testFiles
    .map(toPosix)
    .filter((test) => test.slice(0, test.lastIndexOf("/")) === directory);
}

export function domainsForPath(path) {
  const file = toPosix(path);
  const override = PATH_DOMAIN_OVERRIDES.find(({ pattern }) => pattern.test(file));
  if (override) {
    return override.domains.filter((domain) => !FALLBACK_DOMAIN_EXCLUDE.has(domain));
  }

  return Object.entries(DOMAIN_KEYWORDS)
    .filter(([domain]) => !FALLBACK_DOMAIN_EXCLUDE.has(domain))
    .filter(([, keywords]) => pathMatchesAnyKeyword(file, keywords))
    .map(([domain]) => domain);
}

function sharedMeaningfulToken(sourcePath, testPath) {
  const testTokens = meaningfulTokens(testPath);
  for (const sourceToken of meaningfulTokens(sourcePath)) {
    const match = testTokens.find((testToken) => tokensShare(sourceToken, testToken));
    if (match) return sourceToken;
  }
  return null;
}

function reasonPriority(reason) {
  if (reason === "sibling") return 0;
  if (reason === "route") return 1;
  if (reason === "import") return 2;
  if (reason.startsWith("token:")) return 3;
  if (reason.startsWith("domain:")) return 4;
  if (reason.startsWith("domain-content:")) return 5;
  if (reason === "force-all") return 6;
  return 7;
}

function dedupeMatches(matches) {
  const best = new Map();
  for (const match of matches) {
    const key = `${match.source ?? ""}\u0000${match.test}`;
    const current = best.get(key);
    if (!current || reasonPriority(match.reason) < reasonPriority(current.reason)) {
      best.set(key, match);
    }
  }
  return [...best.values()].sort((left, right) => {
    const sourceOrder = (left.source ?? "").localeCompare(right.source ?? "");
    return sourceOrder !== 0 ? sourceOrder : left.test.localeCompare(right.test);
  });
}

/**
 * Koble endrede filer til tester.
 *
 * Rekkefølgen på reglene er også prioriteten i rapporten:
 *   1. endret testfil
 *   2. direkte søskentest
 *   3. rute-/sidemappe
 *   4. reverse import (testen importerer eller mocker den endrede modulen)
 *   5. delt meningsbærende token
 *   6. domenefallback (inkl. innhold for integrasjonstester)
 *
 * @returns {{
 *   tests: string[],
 *   matches: Array<{source: string|null, test: string, reason: string}>,
 *   changedSources: string[],
 *   changedTests: string[],
 *   unmatchedSources: string[],
 *   skippedTests: string[],
 *   forcedAll: boolean,
 *   forceReasons: string[],
 *   ignoredChanged: string[],
 * }}
 */
export function mapChangedFilesToTests({
  changedFiles,
  testFiles,
  readFile = () => "",
  exists = () => false,
  mode = "unit",
}) {
  const normalizedChanged = [...new Set(changedFiles.map(toPosix))];
  const normalizedTests = [...new Set(testFiles.map(toPosix))];
  const modeTests = normalizedTests.filter((test) => modeMatches(test, mode));
  const modeSet = new Set(modeTests);

  const changedTests = normalizedChanged.filter(
    (file) => file.startsWith("src/") && isTestFile(file),
  );
  const changedSources = normalizedChanged.filter(isSourceFile);
  const forcedAll = normalizedChanged.some((file) =>
    FORCE_ALL_PATTERNS.some((pattern) => pattern.test(file)),
  );
  const forceReasons = forcedAll ? normalizedChanged.filter((file) =>
    FORCE_ALL_PATTERNS.some((pattern) => pattern.test(file)),
  ) : [];

  const matches = [];
  const add = (source, test, reason) => {
    if (!modeSet.has(test)) return;
    matches.push({ source, test, reason });
  };

  for (const test of changedTests) {
    if (modeSet.has(test)) {
      matches.push({ source: null, test, reason: "changed-test" });
    }
  }

  if (forcedAll) {
    for (const test of modeTests) add("*", test, "force-all");
  }

  const siblingTests = new Set();
  const routeTests = new Set();
  for (const source of changedSources) {
    for (const test of findSiblingTests(source, normalizedTests)) {
      siblingTests.add(test);
      add(source, test, "sibling");
    }
    for (const test of findRouteTests(source, normalizedTests)) {
      routeTests.add(test);
      add(source, test, "route");
    }
  }

  // Reverse imports: les hver test én gang og se om den peker på en endret fil.
  const changedSourceSet = new Set(changedSources);
  const contentCache = new Map();
  const readCached = (file) => {
    if (!contentCache.has(file)) contentCache.set(file, readFile(file) ?? "");
    return contentCache.get(file);
  };

  for (const test of normalizedTests) {
    if (!modeSet.has(test)) continue;
    const content = readCached(test);
    for (const specifier of extractImportSpecifiers(content)) {
      const resolved = resolveImportPath(specifier, test, exists);
      if (resolved && changedSourceSet.has(resolved)) {
        add(resolved, test, "import");
      }
    }
  }

  // Delt token og domenefallback. Begge er bevisst bredere enn import:
  // de skal fange moduler der testene ligger i en søstermappe eller bruker
  // et annet ord for samme domene (faktura/billing, utlegg/expenses).
  for (const source of changedSources) {
    const domains = domainsForPath(source);
    for (const test of modeTests) {
      if (!siblingTests.has(test) && !routeTests.has(test)) {
        const token = sharedMeaningfulToken(source, test);
        if (token) add(source, test, `token:${token}`);
      }

      if (domains.length === 0) continue;
      const keywords = domains.flatMap((domain) => DOMAIN_KEYWORDS[domain] ?? []);
      if (pathMatchesAnyKeyword(test, keywords)) {
        const domain = domains.find((candidate) =>
          pathMatchesAnyKeyword(test, DOMAIN_KEYWORDS[candidate] ?? []),
        );
        add(source, test, `domain:${domain}`);
      } else if (mode !== "unit" && isIntegrationTest(test)) {
        const content = readCached(test);
        const domain = domains.find((candidate) => {
          const contentKeywords = DOMAIN_CONTENT_KEYWORDS[candidate] ?? [];
          return contentKeywords.length > 0 && contentMatchesAnyKeyword(content, contentKeywords);
        });
        if (domain) add(source, test, `domain-content:${domain}`);
      }
    }
  }

  const deduped = dedupeMatches(matches);
  const tests = [...new Set(deduped.map((match) => match.test))].sort();
  const matchedSources = new Set(
    deduped.map((match) => match.source).filter((source) => source && source !== "*"),
  );
  const unmatchedSources = forcedAll
    ? []
    : changedSources.filter((source) => !matchedSources.has(source));
  const skippedTests = changedTests.filter((test) => !modeMatches(test, mode));
  const ignoredChanged = normalizedChanged.filter(
    (file) => !isSourceFile(file) && !changedTests.includes(file),
  );

  return {
    tests,
    matches: deduped,
    changedSources,
    changedTests,
    unmatchedSources,
    skippedTests,
    forcedAll,
    forceReasons,
    ignoredChanged,
  };
}

/**
 * Velg tester for en navngitt modul. Brukes av `test-module.mjs` og deler
 * nøkkelord med domenefallbacken slik at `test:changed` og `test:module`
 * aldri blir uenige om hva som hører til en modul.
 */
export function collectModuleTests({
  moduleName,
  testFiles,
  readFile = () => "",
  mode = "unit",
}) {
  const target = MODULE_TARGETS[moduleName];
  if (!target) return null;

  const keywords = target.domains.flatMap((domain) => DOMAIN_KEYWORDS[domain] ?? []);
  const contentKeywords = target.domains.flatMap(
    (domain) => DOMAIN_CONTENT_KEYWORDS[domain] ?? [],
  );
  const tests = [...new Set(testFiles.map(toPosix))]
    .filter((test) => modeMatches(test, mode))
    .filter((test) => {
      if (target.paths.some((pattern) => pattern.test(test))) return true;
      if (pathMatchesAnyKeyword(test, keywords)) return true;
      return (
        mode !== "unit" &&
        isIntegrationTest(test) &&
        contentKeywords.length > 0 &&
        contentMatchesAnyKeyword(readFile(test) ?? "", contentKeywords)
      );
    })
    .sort();

  return { tests, target, keywords };
}

export const MODULE_NAMES = Object.keys(MODULE_TARGETS);
