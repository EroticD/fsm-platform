#!/usr/bin/env node
/**
 * Tar tilskårne fokusbilder til brukermanualen.
 *
 * Forutsetter at produksjonsbygget kjører på SCREENSHOT_BASE_URL (standard
 * http://127.0.0.1:3100) med DATABASE_URL satt til fsm_ui_e2e eller fsm_test.
 *
 *   DATABASE_URL=postgresql://.../fsm_ui_e2e?schema=public \
 *     SCREENSHOT_BASE_URL=http://127.0.0.1:3101 \
 *     node scripts/capture-manual-screenshots.mjs
 *
 * Skriptet lager:
 *   - screenshots/manual/<navn>.jpg
 *   - screenshots/manual/manifest.json
 *
 * Hvert bilde er ett bestemt panel, merket med en stabil data-attributt i
 * appen. Panelet får en tynn lime-ramme og litt luft rundt seg. Alle data er
 * fiktive demo-rader fra scripts/seed-e2e.mjs og de idempotente
 * demofiksturene i scripts/lib/screenshot-fixtures.mjs.
 */
import "dotenv/config";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { chromium } from "playwright";
import sharp from "sharp";
import {
  ensureBillingFixtures,
  ensureExpenseFixtures,
  ensureInventoryFixtures,
  resolveFixtures,
} from "./lib/screenshot-fixtures.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const MANUAL_DIR = resolve(ROOT, "screenshots/manual");
const BASE_URL = (
  process.env.SCREENSHOT_BASE_URL || "http://127.0.0.1:3100"
).replace(/\/+$/, "");
const DATABASE_URL = process.env.DATABASE_URL;

const DEVICE = {
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  locale: "nb-NO",
  timezoneId: "Europe/Oslo",
  colorScheme: "light",
};

const PADDING = 22;
const OUTLINE_COLOR = "#d8ff3e";

const CREDENTIALS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL || "admin@example.test",
    password: process.env.E2E_ADMIN_PASSWORD || "AdminTest123!",
  },
};

const FOCUS_CSS = `
  html {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }
  ::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  *, *::before, *::after {
    animation: none !important;
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    transition: none !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
  }
  [data-sonner-toaster],
  [data-sonner-toast],
  nextjs-portal {
    display: none !important;
  }
  .fixed.inset-x-0.bottom-0.z-40,
  nav.fixed.inset-x-0.bottom-0 {
    display: none !important;
  }
`;

function urlFor(path) {
  return new URL(path, `${BASE_URL}/`).href;
}

function resolveDatabaseUrl() {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL må være satt til den isolerte E2E-databasen (fsm_ui_e2e/fsm_test).",
    );
  }
  if (
    process.env.ALLOW_SCREENSHOT_DB !== "1" &&
    !DATABASE_URL.includes("fsm_ui_e2e") &&
    !DATABASE_URL.includes("fsm_test")
  ) {
    throw new Error(
      "Skriptet nekter å kjøre: DATABASE_URL peker ikke på fsm_ui_e2e eller " +
        "fsm_test. Sett ALLOW_SCREENSHOT_DB=1 bare hvis du virkelig vet hva du gjør.",
    );
  }
  const parsed = new URL(DATABASE_URL);
  const schema = parsed.searchParams.get("schema") ?? undefined;
  parsed.searchParams.delete("schema");
  return { connectionString: parsed.toString(), schema };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  let lastError = "ingen respons";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(urlFor("/api/ready"), {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body.status === "ready") {
          console.log(`✔ Server klar: ${BASE_URL} (/api/ready)`);
          return;
        }
        lastError = `HTTP ${response.status} ${JSON.stringify(body)}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(
    `Serveren svarte ikke «ready» på ${BASE_URL}/api/ready: ${lastError}`,
  );
}

async function waitForNetworkIdle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 6_000 });
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    // /api/events er en langvarig SSE-tilkobling; da fortsetter vi etter load.
  }
}

async function settle(page) {
  await page.addStyleTag({ content: FOCUS_CSS });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate(
    () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }),
  );
  await page.waitForTimeout(500);
}

async function login(browser, credentials) {
  const context = await browser.newContext(DEVICE);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);

    await page.goto(urlFor("/logg-inn"), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.getByLabel("E-post", { exact: true }).fill(credentials.email);
    await page.getByLabel("Passord", { exact: true }).fill(credentials.password);

    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"), {
        timeout: 30_000,
      }),
      page.getByRole("button", { name: "Logg inn", exact: true }).click(),
    ]);

    const response = await page.request.get(urlFor("/api/auth/session"));
    if (!response.ok()) {
      throw new Error(
        `Innlogging for ${credentials.email} ga HTTP ${response.status()} fra /api/auth/session.`,
      );
    }
    const session = await response.json();
    if (
      typeof session?.user?.email !== "string" ||
      session.user.email.toLowerCase() !== credentials.email.toLowerCase()
    ) {
      throw new Error(
        `Innlogging for ${credentials.email} ga feil økt ` +
          `(fant ${session?.user?.email ?? "ingen e-post"}).`,
      );
    }

    return await context.storageState();
  } finally {
    await context.close();
  }
}

function buildShots(fixtures) {
  return [
    {
      file: "rute-manuell-rekkefølge.jpg",
      route: "/kalender/rute",
      selector: "[data-manual-route-form]",
      role: "admin",
      captionNb: "Manuell rekkefølge for ruten",
      captionEn: "Manual route order",
      note: "Skjemaet lagrer en manuell rekkefølge uten å endre datoene.",
    },
    {
      file: "rute-overtid.jpg",
      route: "/kalender/rute",
      selector: "[data-route-overtime]",
      role: "admin",
      captionNb: "Rutens nøkkeltall, inkludert overtid",
      captionEn: "Route totals, including overtime",
      note:
        "Viser alltid summeringen. Overtidsvarselet vises i tillegg når " +
        "planen faktisk har overtid.",
    },
    {
      file: "oppdrag-rekkefølge.jpg",
      route: `/oppdrag/${fixtures.detailOrderId}`,
      selector: "[data-workorder-route-sequence]",
      role: "admin",
      captionNb: "Dager og tid med rekkefølgekolonne",
      captionEn: "Days and time with route sequence column",
      note: "Rekkefølgen settes per arbeidsdag på oppdraget.",
    },
    {
      file: "tilbud-liste.jpg",
      route: "/tilbud",
      selector: "[data-quotes-list]",
      role: "admin",
      captionNb: "Tilbudslisten",
      captionEn: "Quote list",
      note: "Ett demotilbud i status Sendt.",
    },
    {
      file: "faktura-betaling.jpg",
      route: `/faktura/${fixtures.invoiceId}`,
      selector: "[data-payment-panel]",
      role: "admin",
      captionNb: "Betalingslenke på en sendt faktura",
      captionEn: "Payment link on a sent invoice",
      note:
        "Betalingsleverandør er ikke konfigurert i demomiljøet, så panelet " +
        "viser den deaktiverte tilstanden med forklaring.",
    },
    {
      file: "regnskap-innstillinger.jpg",
      route: "/faktura/innstillinger",
      selector: "[data-accounting-settings]",
      role: "admin",
      captionNb: "Regnskapssynk",
      captionEn: "Accounting sync",
      note:
        "Viser leverandør, tilkobling og siste test/synk. Ingen hemmeligheter " +
        "vises.",
    },
    {
      file: "lager-innkjop.jpg",
      route: "/lager/innkjop",
      selector: "[data-purchase-orders]",
      role: "admin",
      captionNb: "Innkjøpsordrer",
      captionEn: "Purchase orders",
      note: "Ett demoinnkjøp i status Bestilt.",
    },
    {
      file: "utlegg-godkjenning.jpg",
      route: "/utlegg/kontor",
      selector: "[data-expense-approval]",
      role: "admin",
      captionNb: "Kjøreturer og utlegg til godkjenning",
      captionEn: "Mileage and expenses awaiting approval",
      note: "Én demokjøretur og ett demoutlegg, begge i status Til godkjenning.",
    },
    {
      file: "lonnsomhet-kpi.jpg",
      route: "/lonnsomhet",
      selector: "[data-bi-kpis]",
      role: "admin",
      captionNb: "Nøkkeltall i lønnsomhetsrapporten",
      captionEn: "Profitability key figures",
      note: "Tallene er estimater fra demo-oppdragene i perioden.",
    },
    {
      file: "innstillinger-email.jpg",
      route: "/innstillinger?tab=email",
      selector: "[data-email-settings]",
      role: "admin",
      captionNb: "Automatisk e-post",
      captionEn: "Transactional email",
      note:
        "SMTP-status og hendelsesvalg. Uten SMTP vises den trygge " +
        "deaktiverte tilstanden.",
    },
    {
      file: "innstillinger-push.jpg",
      route: "/innstillinger?tab=push",
      selector: "[data-push-settings]",
      role: "admin",
      captionNb: "Pushvarsler",
      captionEn: "Push notifications",
      note:
        "FCM/APNs er ikke konfigurert i demomiljøet; panelet viser status for " +
        "enheter og utboks uten hemmeligheter.",
    },
    {
      file: "innstillinger-saml.jpg",
      route: "/innstillinger?tab=sso",
      selector: "[data-saml-settings]",
      role: "admin",
      captionNb: "SAML 2.0-leverandører",
      captionEn: "SAML 2.0 providers",
      note:
        "Ingen SAML-leverandør er konfigurert i demomiljøet, så panelet viser " +
        "den tomme tilstanden.",
    },
    {
      file: "innstillinger-feltpolicy.jpg",
      route: "/innstillinger?tab=roller",
      selector: "[data-field-policy]",
      role: "admin",
      captionNb: "Feltnivå-RBAC",
      captionEn: "Field-level RBAC",
      note: "Skrivebeskyttet matrise med felttilgang per rolle.",
    },
    {
      file: "api-oversikt.jpg",
      route: "/innstillinger?tab=api",
      selector: "[data-api-settings]",
      role: "admin",
      captionNb: "API-nøkler",
      captionEn: "API keys",
      note:
        "Opprettelse og liste over nøkler. Hemmeligheten vises bare ved " +
        "opprettelse, og demomiljøet har ingen aktive nøkler.",
    },
  ];
}

async function captureFocus(page, shot) {
  const response = await page.goto(urlFor(shot.route), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  await waitForNetworkIdle(page);
  await settle(page);

  if (response && response.status() >= 400) {
    throw new Error(
      `HTTP ${response.status()} for ${shot.route}.`,
    );
  }

  // next-intl viser «common.<nøkkel>» når en tekst mangler. Et slikt bilde er
  // ikke brukbart i manualen, så vi feiler i stedet for å lagre det.
  const visibleText = await page.evaluate(
    () => document.body?.innerText ?? "",
  );
  const missingKey = visibleText.match(/common\.[a-z][\w.]*/i);
  if (missingKey) {
    throw new Error(
      `Uoversatt tekstnøkkel «${missingKey[0]}» på ${shot.route}.`,
    );
  }

  const locator = page.locator(shot.selector).first();
  await locator.waitFor({ state: "visible", timeout: 20_000 });

  if (shot.selector === "[data-push-settings]") {
    // Pushpanelet henter status etter hydrering. Vent til lasteteksten er borte
    // slik at bildet viser faktisk tilstand, ikke en lastespinner.
    await page
      .waitForFunction(
        () => {
          const element = document.querySelector("[data-push-settings]");
          return (
            element &&
            !(element.textContent ?? "").includes("Laster status")
          );
        },
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => {});
  }

  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);

  const absolutePath = resolve(MANUAL_DIR, shot.file);
  await mkdir(dirname(absolutePath), { recursive: true });
  const tempPath = resolve(
    MANUAL_DIR,
    `.focus-${process.pid}-${shot.file.replace(/\.jpg$/, ".png")}`,
  );

  try {
    // Elementfangst gir alltid riktig utsnitt, også når panelet er høyere enn
    // viewporten. Deretter legger sharp på luft og en tynn lime-ramme.
    await locator.screenshot({
      path: tempPath,
      type: "png",
      animations: "disabled",
      caret: "hide",
    });

    const element = await sharp(tempPath).metadata();
    if (!element.width || !element.height) {
      throw new Error(`Fant ikke dimensjonene til ${shot.selector}.`);
    }
    const padding = PADDING * DEVICE.deviceScaleFactor;
    const width = element.width + padding * 2;
    const height = element.height + padding * 2;
    const outline = Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="3" y="3" width="${width - 6}" height="${height - 6}" ` +
        `rx="14" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="3"/>` +
        `</svg>`,
    );

    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: "#f2efe6",
      },
    })
      .composite([
        { input: tempPath, left: padding, top: padding },
        { input: outline, left: 0, top: 0 },
      ])
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(absolutePath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }

  const metadata = await sharp(absolutePath).metadata();
  const { size } = await stat(absolutePath);
  const h1 = await page.evaluate(() =>
    Array.from(document.querySelectorAll("h1")).map((element) =>
      (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
  );

  return {
    file: `screenshots/manual/${shot.file}`,
    route: shot.route,
    selector: shot.selector,
    role: shot.role,
    caption: { nb: shot.captionNb, en: shot.captionEn },
    note: shot.note,
    dimensions: { width: metadata.width, height: metadata.height },
    width: metadata.width,
    height: metadata.height,
    bytes: size,
    h1,
    finalUrl: page.url(),
    capturedAt: new Date().toISOString(),
  };
}

async function main() {
  const { connectionString, schema } = resolveDatabaseUrl();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }, { schema }),
  });

  await waitForReady();
  const baseFixtures = await resolveFixtures(prisma);
  const [billingFixtures, inventoryFixtures, expenseFixtures] =
    await Promise.all([
      ensureBillingFixtures(prisma, baseFixtures),
      ensureInventoryFixtures(prisma, baseFixtures),
      ensureExpenseFixtures(prisma, baseFixtures),
    ]);
  const fixtures = {
    ...baseFixtures,
    ...billingFixtures,
    ...inventoryFixtures,
    ...expenseFixtures,
  };
  const shots = buildShots(fixtures);

  console.log(
    `Tar manuelle fokusbilder fra ${BASE_URL} → ${relative(ROOT, MANUAL_DIR)}`,
  );
  console.log(`Bilder: ${shots.length}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--lang=nb-NO"],
  });

  const sessions = {};
  const results = [];
  const failures = [];

  try {
    for (const [role, credentials] of Object.entries(CREDENTIALS)) {
      console.log(`Logger inn ${role} (${credentials.email}) …`);
      sessions[role] = await login(browser, credentials);
    }

    const pages = new Map();
    async function pageFor(role) {
      if (!pages.has(role)) {
        const context = await browser.newContext({
          ...DEVICE,
          storageState: sessions[role],
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        pages.set(role, { context, page });
      }
      return pages.get(role).page;
    }

    for (const shot of shots) {
      const page = await pageFor(shot.role);
      try {
        const capture = await captureFocus(page, shot);
        results.push(capture);
        console.log(
          `✔ ${shot.file.padEnd(34)} ${capture.width}×${capture.height} ` +
            formatBytes(capture.bytes),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          file: `screenshots/manual/${shot.file}`,
          route: shot.route,
          selector: shot.selector,
          error: message,
        });
        console.error(`✖ ${shot.file}: ${message}`);
      }
    }

    await Promise.all(
      Array.from(pages.values()).map(({ context }) => context.close()),
    );
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  const packageJson = JSON.parse(
    await readFile(resolve(ROOT, "package.json"), "utf8"),
  );

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    appVersion: packageJson.version,
    baseUrl: BASE_URL,
    database: `${new URL(DATABASE_URL).pathname.replace(/^\//, "")} (isolert E2E-database)`,
    viewport: {
      width: DEVICE.viewport.width,
      height: DEVICE.viewport.height,
      deviceScaleFactor: DEVICE.deviceScaleFactor,
    },
    fixtures: {
      detailOrderId: fixtures.detailOrderId,
      invoiceId: fixtures.invoiceId,
      quoteId: fixtures.quoteId,
      purchaseOrderId: fixtures.purchaseOrderId,
      expenseId: fixtures.expenseId,
      mileageTripId: fixtures.mileageTripId,
    },
    counts: {
      images: results.length,
      failures: failures.length,
    },
    images: results,
    failures,
  };

  await writeFile(
    resolve(MANUAL_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log("\n--- Oppsummering ---");
  console.log(`Bilder: ${results.length}/${shots.length}`);
  console.log(`Feil: ${failures.length}`);
  console.log(`Manifest: ${relative(ROOT, resolve(MANUAL_DIR, "manifest.json"))}`);

  if (failures.length > 0) {
    console.error("\n✖ Noen fokusbilder ble ikke fanget:");
    for (const failure of failures) {
      console.error(`  - ${failure.file} (${failure.selector}): ${failure.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\n✔ Alle fokusbilder er fanget uten feil.");
  }
}

main().catch((error) => {
  console.error("\n✖ Fokusfangsten feilet.");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
