#!/usr/bin/env node
/**
 * Tar komplette skjermbilder av alle sider i appen mot den isolerte E2E-databasen.
 *
 * Forutsetter at produksjonsbygget kjører på SCREENSHOT_BASE_URL (standard
 * http://127.0.0.1:3100) med DATABASE_URL satt til fsm_ui_e2e eller fsm_test.
 *
 *   DATABASE_URL=postgresql://.../fsm_ui_e2e?schema=public \
 *     SCREENSHOT_BASE_URL=http://127.0.0.1:3100 \
 *     node scripts/capture-all-screenshots.mjs
 *
 * Skriptet lager:
 *   - screenshots/pages/desktop/<slug>.jpg
 *   - screenshots/pages/mobile/<slug>.jpg
 *   - screenshots/pages/manifest.json
 *   - de 15 README-bildene i screenshots/ (samme navn som før)
 *
 * Alle data og kontoer er fiktive demo-rader fra scripts/seed-e2e.mjs.
 */
import "dotenv/config";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { chromium } from "playwright";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const SCREENSHOT_DIR = resolve(ROOT, "screenshots");
const PAGES_DIR = resolve(SCREENSHOT_DIR, "pages");
const BASE_URL = (
  process.env.SCREENSHOT_BASE_URL || "http://127.0.0.1:3100"
).replace(/\/+$/, "");
const DATABASE_URL = process.env.DATABASE_URL;

const DESKTOP = {
  key: "desktop",
  device: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
    colorScheme: "light",
  },
  width: 1440,
  height: 900,
};

const MOBILE = {
  key: "mobile",
  device: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
    colorScheme: "light",
  },
  width: 390,
  height: 844,
};

const CREDENTIALS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL || "admin@example.test",
    password: process.env.E2E_ADMIN_PASSWORD || "AdminTest123!",
  },
  technician: {
    email: process.env.E2E_TECHNICIAN_EMAIL || "montor@example.test",
    password: process.env.E2E_TECHNICIAN_PASSWORD || "TechTest123!",
  },
  customer: {
    email: process.env.E2E_CUSTOMER_EMAIL || "kunde@example.test",
    password: process.env.E2E_CUSTOMER_PASSWORD || "CustomerTest123!",
  },
};

const LEGACY_SCREENSHOTS = [
  "01-dashbord.png",
  "02-oppdrag.png",
  "03-oppdrag-detalj.png",
  "04-kalender.png",
  "05-kunder.png",
  "06-kunde-detalj.png",
  "07-dokumenter.png",
  "08-dokumenter-mappe.png",
  "09-rapporter.png",
  "10-innstillinger-sikkerhet.png",
  "11-innstillinger-merkevare.png",
  "12-mobil-dashbord.png",
  "13-mobil-oppdrag.png",
  "14-kundeportal.png",
  "15-kundeportal-mobil.png",
];

const CAPTURE_CSS = `
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
  /* Fullsidebilder skal ikke vise fastlåste bunnfelt midt i innholdet. */
  .sticky.bottom-0 {
    position: static !important;
    bottom: auto !important;
  }
  .fixed.inset-x-0.bottom-0.z-40,
  nav.fixed.inset-x-0.bottom-0 {
    display: none !important;
  }
  /* Forbigående toast-vinduer skal ikke havne i dokumentasjonen. */
  [data-sonner-toaster],
  [data-sonner-toast],
  nextjs-portal {
    display: none !important;
  }
  /*
   * Dokumentbibliotekets verktøylinje bruker -mx-4 (16 px) inne i en
   * p-3-container (12 px). På mobil gir det 4 px horisontal overflow og et
   * fullsidebilde som er 394 px bredt i stedet for 390. Vi normaliserer bare
   * selve fangsten, uten å endre appens layout.
   */
  @media (max-width: 639px) {
    main .sticky.top-0.z-30 {
      margin-left: -12px !important;
      margin-right: -12px !important;
    }
  }
`;

const ERROR_PHRASES = [
  "application error",
  "unhandled runtime error",
  "internal server error",
  "this page could not be found",
  "a client-side exception has occurred",
];

function urlFor(path) {
  return new URL(path, `${BASE_URL}/`).href;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
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
  throw new Error(`Serveren svarte ikke «ready» på ${BASE_URL}/api/ready: ${lastError}`);
}

async function waitForNetworkIdle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 6_000 });
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    // /api/events er en langvarig SSE-tilkobling; da fortsetter vi etter load.
    console.warn("  … networkidle uteble (langvarig SSE); fortsetter etter last.");
  }
}

/** Slår av animasjoner, laster lazy-innhold og venter på fonter/bilder. */
async function settle(page) {
  await page.addStyleTag({ content: CAPTURE_CSS });

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // Last lazy-bilder og innhold under folden før fullsidebildet tas.
  await page.evaluate(async () => {
    const step = Math.max(500, window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolveFrame) => setTimeout(resolveFrame, 30));
    }
    window.scrollTo(0, 0);
  });

  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every(
          (image) => image.complete || image.loading === "lazy",
        ),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});

  await page.evaluate(
    () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }),
  );

  // Suspense-innhold kan streames like etter last; gi lister og tellinger tid.
  await page.waitForTimeout(700);
}

async function login(browser, credentials) {
  const context = await browser.newContext(DESKTOP.device);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);

    await page.goto(urlFor("/logg-inn"), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.getByLabel("E-post", { exact: true }).fill(credentials.email);
    await page.getByLabel("Passord", { exact: true }).fill(credentials.password);

    try {
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"), {
          timeout: 30_000,
        }),
        page.getByRole("button", { name: "Logg inn", exact: true }).click(),
      ]);
    } catch (error) {
      const loginError = await page
        .locator("#login-error")
        .innerText()
        .catch(() => "");
      throw new Error(
        `Innlogging feilet for ${credentials.email}. ` +
          (loginError ? `Vist feil: ${loginError}` : "Siden forlot ikke /logg-inn."),
        { cause: error },
      );
    }

    const response = await page.request.get(urlFor("/api/auth/session"));
    if (!response.ok()) {
      throw new Error(
        `Innlogging for ${credentials.email} ga HTTP ${response.status()} fra /api/auth/session.`,
      );
    }
    const session = await response.json();
    const sessionEmail = session?.user?.email;
    if (
      typeof sessionEmail !== "string" ||
      sessionEmail.toLowerCase() !== credentials.email.toLowerCase()
    ) {
      throw new Error(
        `Innlogging for ${credentials.email} ga feil økt ` +
          `(fant ${sessionEmail ?? "ingen e-post"}).`,
      );
    }

    return await context.storageState();
  } finally {
    await context.close();
  }
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
      "Skjermbildeskriptet nekter å kjøre: DATABASE_URL peker ikke på " +
        "fsm_ui_e2e eller fsm_test. Sett ALLOW_SCREENSHOT_DB=1 bare hvis du " +
        "virkelig vet hva du gjør.",
    );
  }

  const parsed = new URL(DATABASE_URL);
  const schema = parsed.searchParams.get("schema") ?? undefined;
  parsed.searchParams.delete("schema");
  return { connectionString: parsed.toString(), schema };
}

async function resolveFixtures(prisma) {
  const workOrders = await prisma.workOrder.findMany({
    where: {
      title: {
        in: [
          "Service – automatiske dører",
          "Feilsøking – portåpner",
          "Service – kjøleanlegg",
        ],
      },
    },
    select: { id: true, title: true },
  });
  const workOrderByTitle = new Map(
    workOrders.map((workOrder) => [workOrder.title, workOrder.id]),
  );

  const customer = await prisma.customer.findFirst({
    where: { name: "Nordvik Testindustri AS" },
    select: { id: true, name: true },
  });
  const product = await prisma.product.findFirst({
    where: { model: "Portautomatikk PA-400" },
    select: { id: true, model: true },
  });
  const folder = await prisma.documentFolder.findFirst({
    where: { name: "Driftshåndbøker" },
    select: { id: true, name: true },
  });
  const document = await prisma.document.findFirst({
    where: { title: { startsWith: "Bruksanvisning" } },
    select: { id: true, title: true },
  });
  const template = await prisma.template.findFirst({
    where: { title: "Service av porter" },
    select: { id: true, title: true },
  });

  const technicianOrderId = workOrderByTitle.get("Service – automatiske dører");
  const detailOrderId = workOrderByTitle.get("Feilsøking – portåpner");
  const reportedOrderId = workOrderByTitle.get("Service – kjøleanlegg");

  const report = reportedOrderId
    ? await prisma.report.findFirst({
        where: { workOrderId: reportedOrderId },
        select: { id: true, workOrderId: true },
        orderBy: { createdAt: "asc" },
      })
    : null;

  const missing = [];
  if (!technicianOrderId) missing.push("oppdraget «Service – automatiske dører»");
  if (!detailOrderId) missing.push("oppdraget «Feilsøking – portåpner»");
  if (!reportedOrderId) missing.push("oppdraget «Service – kjøleanlegg»");
  if (!customer) missing.push("kunden «Nordvik Testindustri AS»");
  if (!product) missing.push("enheten «Portautomatikk PA-400»");
  if (!folder) missing.push("mappen «Driftshåndbøker»");
  if (!document) missing.push("dokumentet «Bruksanvisning …»");
  if (!template) missing.push("malen «Service av porter»");
  if (!report) missing.push("rapporten for «Service – kjøleanlegg»");
  if (missing.length > 0) {
    throw new Error(
      `E2E-seeden mangler forventede rader: ${missing.join(", ")}. ` +
        "Kjør `npm run seed:e2e` mot databasen først.",
    );
  }

  return {
    technicianOrderId,
    detailOrderId,
    reportedOrderId,
    reportId: report.id,
    customerId: customer.id,
    customerName: customer.name,
    productId: product.id,
    productName: product.model,
    folderId: folder.id,
    folderName: folder.name,
    documentId: document.id,
    documentTitle: document.title,
    templateId: template.id,
    templateTitle: template.title,
  };
}

function buildRoutes(fixtures) {
  const {
    technicianOrderId,
    detailOrderId,
    reportedOrderId,
    reportId,
    customerId,
    customerName,
    productId,
    productName,
    folderId,
    folderName,
    documentId,
    documentTitle,
    templateId,
    templateTitle,
  } = fixtures;

  const customerPath = `/kunder/${customerId}`;
  const reportPath = `/rapporter/${reportedOrderId}?rapport=${reportId}`;

  const settingsTabs = [
    ["branding", "Merkevare"],
    ["kart", "Kart"],
    ["ansatte", "Ansatte & Roller"],
    ["roller", "Roller & rettigheter"],
    ["avdelinger", "Avdelinger"],
    ["maler", "Sjekklister / Maler"],
    ["tags", "Tags"],
    ["auditlog", "Aktivitetslogg"],
    ["statistikk", "Statistikk"],
    ["sikkerhet", "Sikkerhet"],
    ["api", "API-nøkler"],
  ];

  return [
    // --- Offentlige sider -------------------------------------------------
    {
      slug: "logg-inn",
      route: "/logg-inn",
      role: "public",
      title: "Logg inn",
      heading: "Logg inn",
      expectTexts: ["E-post", "Passord"],
    },
    {
      slug: "glemt-passord",
      route: "/glemt-passord",
      role: "public",
      title: "Glemt passord?",
      heading: "Glemt passord?",
      expectTexts: ["e-postadresse"],
    },
    {
      slug: "tilbakestill-passord",
      route: "/tilbakestill-passord",
      role: "public",
      title: "Tilbakestill passord uten gyldig nøkkel",
      heading: "Manglende sikkerhetsnøkkel",
      expectTexts: ["Ugyldig eller manglende link"],
    },
    {
      slug: "aktiver-konto",
      route: "/aktiver-konto",
      role: "public",
      title: "Aktiver konto uten gyldig nøkkel",
      heading: "Manglende invitasjonsnøkkel",
      expectTexts: ["Ugyldig eller manglende invitasjonslenke"],
    },
    {
      slug: "404-finnes-ikke",
      route: "/finnes-ikke",
      role: "public",
      title: "404 – siden finnes ikke",
      heading: "Siden finnes ikke",
      expectTexts: ["404"],
      expectedStatus: 404,
      special: true,
    },

    // --- Kontor / administrator ------------------------------------------
    {
      slug: "dashbord",
      route: "/",
      role: "admin",
      title: "Dashbord",
      heading: "Planlegging",
      legacy: { desktop: "01-dashbord.png", mobile: "12-mobil-dashbord.png" },
    },
    {
      slug: "dashbord-tavle",
      route: "/?vis=tavle",
      role: "admin",
      title: "Dashbord – tavle",
      heading: "Planlegging",
      expectTexts: ["Forfalt", "I dag", "Pågår", "Ikke tildelt"],
    },
    {
      slug: "oppdrag",
      route: "/oppdrag",
      role: "admin",
      title: "Oppdrag",
      heading: /Aktive/,
      expectTexts: ["oppdrag"],
      legacy: { desktop: "02-oppdrag.png" },
    },
    {
      slug: "oppdrag-ny",
      route: "/oppdrag/ny",
      role: "admin",
      title: "Opprett nytt oppdrag",
      heading: "Opprett nytt oppdrag",
    },
    {
      slug: "oppdrag-slettede",
      route: "/oppdrag/slettede",
      role: "admin",
      title: "Papirkurv",
      heading: "Papirkurv",
    },
    {
      slug: "oppdrag-detalj",
      route: `/oppdrag/${detailOrderId}`,
      role: "admin",
      title: "Oppdragsdetalj – Feilsøking – portåpner",
      heading: "Feilsøking – portåpner",
      expectTexts: ["Feilsøking – portåpner"],
      legacy: { desktop: "03-oppdrag-detalj.png" },
    },
    {
      slug: "oppdrag-rediger",
      route: `/oppdrag/${detailOrderId}/rediger`,
      role: "admin",
      title: "Rediger oppdrag",
      heading: "Rediger Oppdrag",
    },
    {
      slug: "kalender",
      route: "/kalender",
      role: "admin",
      title: "Kalender – ressursoversikt",
      heading: "Kalender",
      activeNav: "Ressursoversikt",
    },
    {
      slug: "kalender-maned",
      route: "/kalender?vis=maned",
      role: "admin",
      title: "Kalender – måned",
      heading: "Kalender",
      activeNav: "Måned",
      expectTexts: ["Månedsvisning"],
      legacy: { desktop: "04-kalender.png" },
    },
    {
      slug: "kalender-uke",
      route: "/kalender?vis=uke",
      role: "admin",
      title: "Kalender – uke",
      heading: "Kalender",
      activeNav: "Uke",
      expectTexts: ["Ukevisning"],
    },
    {
      slug: "kalender-timeuke",
      route: "/kalender?vis=timegrid",
      role: "admin",
      title: "Kalender – uke med klokkeslett",
      heading: "Kalender",
      activeNav: "Uke (time)",
    },
    {
      slug: "kalender-dag",
      route: "/kalender?vis=dag",
      role: "admin",
      title: "Kalender – dag",
      heading: "Kalender",
      activeNav: "Dag",
    },
    {
      slug: "kalender-2uker",
      route: "/kalender?vis=2uker",
      role: "admin",
      title: "Kalender – to uker",
      heading: "Kalender",
      activeNav: "2 uker",
      expectTexts: ["To-ukers visning"],
    },
    {
      slug: "kalender-dispatch",
      route: "/kalender/dispatch",
      role: "admin",
      title: "Kalender – dispatch",
      heading: "Kalender",
      activeNav: "Dispatch",
      expectTexts: ["Fordel montører"],
    },
    {
      slug: "kart",
      route: "/kart",
      role: "admin",
      title: "Kart",
      heading: "Kart",
    },
    {
      slug: "kunder",
      route: "/kunder",
      role: "admin",
      title: "Kundekatalog",
      heading: "Kundekatalog",
      legacy: { desktop: "05-kunder.png" },
    },
    {
      slug: "kunde-oversikt",
      route: `${customerPath}?tab=oversikt`,
      role: "admin",
      title: `Kunde – ${customerName} – oversikt`,
      heading: customerName,
      activeNav: "Oversikt",
      legacy: { desktop: "06-kunde-detalj.png" },
    },
    {
      slug: "kunde-oppdrag",
      route: `${customerPath}?tab=oppdrag`,
      role: "admin",
      title: `Kunde – ${customerName} – oppdrag`,
      heading: customerName,
      activeNav: "Oppdrag",
      expectTexts: ["Oppdrag"],
    },
    {
      slug: "kunde-utstyr",
      route: `${customerPath}?tab=utstyr`,
      role: "admin",
      title: `Kunde – ${customerName} – utstyr`,
      heading: customerName,
      activeNav: "Utstyr",
      expectTexts: ["Utstyr"],
    },
    {
      slug: "kunde-avtaler",
      route: `${customerPath}?tab=avtaler`,
      role: "admin",
      title: `Kunde – ${customerName} – avtaler`,
      heading: customerName,
      activeNav: "Avtaler",
      expectTexts: ["Serviceavtale"],
    },
    {
      slug: "kunde-mer",
      route: `${customerPath}?tab=mer`,
      role: "admin",
      title: `Kunde – ${customerName} – mer`,
      heading: customerName,
      activeNav: "Mer",
      expectTexts: ["Kontaktpersoner", "Kundeportalbrukere", "Vedlegg"],
    },
    {
      slug: "kunde-rapporter",
      route: `${customerPath}?tab=oppdrag&vis=rapporter`,
      role: "admin",
      title: `Kunde – ${customerName} – rapporter`,
      heading: customerName,
      activeNav: "Oppdrag",
      expectTexts: ["Rapporter"],
    },
    {
      slug: "kunde-rediger",
      route: `${customerPath}/rediger`,
      role: "admin",
      title: "Rediger kunde",
      heading: "Rediger kunde",
    },
    {
      slug: "enhet-detalj",
      route: `/enheter/${productId}`,
      role: "admin",
      title: `Enhet – ${productName}`,
      heading: productName,
      expectTexts: ["NV-4001"],
    },
    {
      slug: "dokumenter",
      route: "/dokumenter",
      role: "admin",
      title: "Dokumentbibliotek",
      heading: "Dokumentbibliotek",
      legacy: { desktop: "07-dokumenter.png" },
    },
    {
      slug: "dokumenter-mappe",
      route: `/dokumenter?folder=${folderId}`,
      role: "admin",
      title: `Dokumentmappe – ${folderName}`,
      heading: "Dokumentbibliotek",
      expectTexts: [folderName],
      legacy: { desktop: "08-dokumenter-mappe.png" },
    },
    {
      slug: "dokumenter-dokument",
      route: `/dokumenter?doc=${documentId}`,
      role: "admin",
      title: `Dokument – ${documentTitle}`,
      heading: "Dokumentbibliotek",
      expectTexts: [documentTitle],
    },
    {
      slug: "rapporter",
      route: "/rapporter",
      role: "admin",
      title: "Servicerapporter",
      heading: "Servicerapporter",
      legacy: { desktop: "09-rapporter.png" },
    },
    {
      slug: "rapport-visning",
      route: reportPath,
      role: "admin",
      title: "Rapportvisning – Service – kjøleanlegg",
      heading: /^Rapport:/,
      expectTexts: ["Service – kjøleanlegg", "DEMO-1001"],
    },
    {
      slug: "rapport-revisjoner",
      route: `/rapporter/${reportedOrderId}/revisjoner?rapport=${reportId}`,
      role: "admin",
      title: "Rapportrevisjoner",
      heading: "Revisjoner",
      expectTexts: ["Service – kjøleanlegg"],
    },
    {
      slug: "sok",
      route: "/sok",
      role: "admin",
      title: "Søk",
      heading: "Søk",
    },
    {
      slug: "sok-service",
      route: "/sok?q=service",
      role: "admin",
      title: "Søk – service",
      heading: "Søk",
      expectTexts: ["Service"],
    },
    {
      slug: "sok-analyse",
      route: "/sok/analyse",
      role: "admin",
      title: "Søkeanalyse",
      heading: "Søkeanalyse",
    },
    {
      slug: "hms",
      route: "/hms",
      role: "admin",
      title: "HMS",
      heading: "HMS",
    },
    {
      slug: "varsler",
      route: "/varsler",
      role: "admin",
      title: "Varsler",
      heading: "Varsler",
    },
    {
      slug: "varsler-innstillinger",
      route: "/varsler/innstillinger",
      role: "admin",
      title: "Varselinnstillinger",
      heading: "Varselinnstillinger",
    },
    ...settingsTabs.map(([tab, label]) => ({
      slug: `innstillinger-${tab}`,
      route: `/innstillinger?tab=${tab}`,
      role: "admin",
      title: `Innstillinger – ${label}`,
      heading: "Innstillinger",
      activeNav: label,
      legacy:
        tab === "sikkerhet"
          ? { desktop: "10-innstillinger-sikkerhet.png" }
          : tab === "branding"
            ? { desktop: "11-innstillinger-merkevare.png" }
            : undefined,
    })),
    {
      slug: "mal-rediger",
      route: `/innstillinger/maler/${templateId}`,
      role: "admin",
      title: `Rediger mal – ${templateTitle}`,
      heading: "Rediger Mal",
      expectInputValues: [templateTitle],
    },
    {
      slug: "brukere",
      route: "/brukere",
      role: "admin",
      title: "Brukere (videresendt til ansatte)",
      heading: "Innstillinger",
      activeNav: "Ansatte & Roller",
      expectedPath: "/innstillinger",
      expectedSearch: { tab: "ansatte" },
      note:
        "Ruten /brukere redirecter til /innstillinger?tab=ansatte. " +
        "Skjermbildet viser sluttilstanden etter redirecten.",
    },

    // --- Montør ------------------------------------------------------------
    {
      slug: "mine-oppdrag",
      route: "/mine-oppdrag",
      role: "technician",
      title: "Mine oppdrag",
      heading: /Hei, Demo Montør/,
      expectTexts: ["Service – automatiske dører"],
    },
    {
      slug: "mine-oppdrag-detalj",
      route: `/mine-oppdrag/${technicianOrderId}`,
      role: "technician",
      title: "Mine oppdrag – Service – automatiske dører",
      heading: "Service – automatiske dører",
      expectTexts: ["Fjordlys Montasje AS"],
      legacy: { mobile: "13-mobil-oppdrag.png" },
    },
    {
      slug: "mine-oppdrag-skjema",
      route: `/mine-oppdrag/${technicianOrderId}/skjema/${templateId}`,
      role: "technician",
      title: `Skjema – ${templateTitle}`,
      heading: templateTitle,
      expectTexts: ["Tilstand", "Resultat"],
    },
    {
      slug: "mine-oppdrag-ny",
      route: "/mine-oppdrag/ny",
      role: "technician",
      title: "Nytt oppdrag (montør)",
      heading: "Opprett nytt oppdrag",
    },
    {
      slug: "mine-oppdrag-kunder",
      route: "/mine-oppdrag/kunder",
      role: "technician",
      title: "Kunde- og utstyrsarkiv",
      heading: "Kunde- og utstyrsarkiv",
      expectTexts: ["Nordvik Testindustri AS"],
    },

    // --- Kundeportal -------------------------------------------------------
    {
      slug: "kundeportal",
      route: "/kundeportal",
      role: "customer",
      title: "Kundeportal – Min Bedrift",
      heading: "Min Bedrift: Nordvik Testindustri AS",
      legacy: {
        desktop: "14-kundeportal.png",
        mobile: "15-kundeportal-mobil.png",
      },
    },
  ];
}

const SKIPPED_ROUTES = [
  {
    route: "/logg-inn/2fa",
    role: "public",
    reason:
      "Redirecter til /logg-inn når det ikke finnes en ventende 2FA-cookie. " +
      "Redirecten verifiseres av skriptet; selve 2FA-skjermen krever en " +
      "påbegynt innlogging med to-trinns verifisering.",
  },
  {
    route: "/kalender/maned",
    role: "admin",
    reason:
      "Bakoverkompatibel alias som redirecter til /kalender?vis=maned. " +
      "Månedsvisningen er fanget der.",
  },
  {
    route: "/kalender/uke",
    role: "admin",
    reason:
      "Bakoverkompatibel alias som redirecter til /kalender?vis=uke. " +
      "Ukevisningen er fanget der.",
  },
  {
    route: "/kalender/uke-2",
    role: "admin",
    reason:
      "Bakoverkompatibel alias som redirecter til /kalender?vis=2uker. " +
      "To-ukersvisningen er fanget der.",
  },
  {
    route: "/enheter",
    role: "admin",
    reason:
      "Legacy-rute som redirecter til /kunder?varsel=enheter. " +
      "Kundekatalogen og enhetsdetaljen er fanget separat.",
  },
  {
    route: "/sikkerhet",
    role: "admin",
    reason:
      "Legacy-rute som redirecter til /innstillinger?tab=sikkerhet. " +
      "Sikkerhetsfanen er fanget der.",
  },
];

const REDIRECT_CHECKS = [
  {
    from: "/logg-inn/2fa",
    role: "public",
    expectedPath: "/logg-inn",
    description: "2FA uten ventende cookie",
  },
  {
    from: "/kalender/maned",
    role: "admin",
    expectedPath: "/kalender",
    expectedSearch: { vis: "maned" },
    description: "gammel månedskalender",
  },
  {
    from: "/kalender/uke",
    role: "admin",
    expectedPath: "/kalender",
    expectedSearch: { vis: "uke" },
    description: "gammel ukekalender",
  },
  {
    from: "/kalender/uke-2",
    role: "admin",
    expectedPath: "/kalender",
    expectedSearch: { vis: "2uker" },
    description: "gammel to-ukerskalender",
  },
  {
    from: "/enheter",
    role: "admin",
    expectedPath: "/kunder",
    expectedSearch: { varsel: "enheter" },
    description: "gammel enhetsliste",
  },
  {
    from: "/sikkerhet",
    role: "admin",
    expectedPath: "/innstillinger",
    expectedSearch: { tab: "sikkerhet" },
    description: "gammel sikkerhetsrute",
  },
  {
    from: "/brukere",
    role: "admin",
    expectedPath: "/innstillinger",
    expectedSearch: { tab: "ansatte" },
    description: "gammel brukerliste",
  },
];

function searchMatches(url, expectedSearch) {
  for (const [key, value] of Object.entries(expectedSearch ?? {})) {
    if (url.searchParams.get(key) !== value) return false;
  }
  return true;
}

async function checkRedirect(page, check) {
  await page.goto(urlFor(check.from), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
  // Next kan gjøre redirecten først etter hydrering. Vent på måladressen før
  // vi måler, ellers ser en vellykket redirect ut som en feil.
  await page
    .waitForURL(
      (url) =>
        url.pathname === check.expectedPath &&
        searchMatches(url, check.expectedSearch),
      { timeout: 3_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(150);
  const finalUrl = new URL(page.url());
  const pass =
    finalUrl.pathname === check.expectedPath &&
    searchMatches(finalUrl, check.expectedSearch);
  return {
    description: check.description,
    from: check.from,
    role: check.role,
    expectedPath: check.expectedPath,
    expectedSearch: check.expectedSearch ?? null,
    finalUrl: finalUrl.href,
    finalPath: finalUrl.pathname,
    finalSearch: finalUrl.search,
    pass,
  };
}

async function captureRoute(page, entry, viewport) {
  const response = await page.goto(urlFor(entry.route), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  await waitForNetworkIdle(page);
  await settle(page);

  const finalUrl = new URL(page.url());
  const expectedPath = entry.expectedPath ?? new URL(entry.route, `${BASE_URL}/`).pathname;
  if (finalUrl.pathname !== expectedPath) {
    throw new Error(
      `Feil sluttadresse for ${entry.route}: forventet ${expectedPath}, ` +
        `fikk ${finalUrl.pathname}${finalUrl.search}.`,
    );
  }
  if (entry.expectedSearch && !searchMatches(finalUrl, entry.expectedSearch)) {
    throw new Error(
      `Feil query for ${entry.route}: forventet ` +
        `${JSON.stringify(entry.expectedSearch)}, fikk ${finalUrl.search}.`,
    );
  }

  const expectedStatus = entry.expectedStatus ?? 200;
  const actualStatus = response?.status() ?? null;
  if (actualStatus !== expectedStatus) {
    throw new Error(
      `Feil HTTP-status for ${entry.route}: forventet ${expectedStatus}, ` +
        `fikk ${actualStatus ?? "ingen respons"}.`,
    );
  }

  const pageInfo = await page.evaluate(() => ({
    h1: Array.from(document.querySelectorAll("h1")).map((element) =>
      (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
    bodyText: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim(),
    activeNav: Array.from(
      document.querySelectorAll('nav a[aria-current="page"]'),
    ).map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()),
    inputValues: Array.from(
      document.querySelectorAll("input, textarea, select"),
    ).map((element) => String(element.value ?? "").trim()),
    documentTitle: document.title,
    imageFailures: Array.from(document.images)
      .filter(
        (image) =>
          image.complete &&
          image.naturalWidth === 0 &&
          image.currentSrc &&
          !image.currentSrc.startsWith("data:"),
      )
      .map((image) => image.currentSrc)
      .slice(0, 5),
  }));

  const bodyText = pageInfo.bodyText;
  const lowerBody = bodyText.toLowerCase();
  if (bodyText.length < 60) {
    throw new Error(
      `Siden ${entry.route} virker tom (bare ${bodyText.length} tegn tekst).`,
    );
  }
  if (pageInfo.h1.length === 0) {
    throw new Error(`Siden ${entry.route} mangler <h1>.`);
  }

  const headingPattern =
    entry.heading instanceof RegExp
      ? entry.heading
      : new RegExp(escapeRegExp(entry.heading), "i");
  const headingText = pageInfo.h1.join(" ");
  if (!headingPattern.test(headingText)) {
    throw new Error(
      `Forventet overskrift ${headingPattern} på ${entry.route}, men fant ` +
        `«${headingText || "(ingen)"}».`,
    );
  }

  for (const expectedText of entry.expectTexts ?? []) {
    if (!lowerBody.includes(expectedText.toLowerCase())) {
      throw new Error(
        `Fant ikke forventet tekst «${expectedText}» på ${entry.route}.`,
      );
    }
  }

  for (const expectedValue of entry.expectInputValues ?? []) {
    if (
      !pageInfo.inputValues.some((value) =>
        value.toLowerCase().includes(expectedValue.toLowerCase()),
      )
    ) {
      throw new Error(
        `Fant ikke forventet skjemaverdi «${expectedValue}» på ${entry.route}.`,
      );
    }
  }

  if (entry.activeNav) {
    const activeNavPattern = new RegExp(escapeRegExp(entry.activeNav), "i");
    if (!pageInfo.activeNav.some((text) => activeNavPattern.test(text))) {
      throw new Error(
        `Forventet aktiv fane «${entry.activeNav}» på ${entry.route}, men fant ` +
          `«${pageInfo.activeNav.join(" | ") || "(ingen)"}».`,
      );
    }
  }

  for (const phrase of ERROR_PHRASES) {
    if (lowerBody.includes(phrase)) {
      throw new Error(
        `Siden ${entry.route} inneholder feilteksten «${phrase}».`,
      );
    }
  }

  const filename = `${entry.slug}.jpg`;
  const relativePath = `screenshots/pages/${viewport.key}/${filename}`;
  const absolutePath = resolve(ROOT, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });

  await page.screenshot({
    path: absolutePath,
    fullPage: true,
    type: "jpeg",
    quality: 82,
    animations: "disabled",
    caret: "hide",
  });

  const metadata = await sharp(absolutePath).metadata();
  const { size } = await stat(absolutePath);
  if (metadata.width !== viewport.width) {
    throw new Error(
      `Feil bredde på ${relativePath}: forventet ${viewport.width}, ` +
        `fikk ${metadata.width}. Siden har trolig horisontal overflow.`,
    );
  }
  if (!metadata.height || metadata.height < viewport.height) {
    throw new Error(
      `Feil høyde på ${relativePath}: forventet minst ${viewport.height}, ` +
        `fikk ${metadata.height ?? 0}.`,
    );
  }

  const capturedAt = new Date().toISOString();
  const result = {
    file: relativePath,
    width: metadata.width,
    height: metadata.height,
    bytes: size,
    capturedAt,
    httpStatus: actualStatus,
    finalUrl: finalUrl.href,
    finalPath: finalUrl.pathname,
    documentTitle: pageInfo.documentTitle,
    h1: pageInfo.h1,
    bodyTextLength: bodyText.length,
    imageFailures: pageInfo.imageFailures,
    legacy: null,
  };

  if (entry.legacy?.[viewport.key]) {
    const legacyName = entry.legacy[viewport.key];
    const legacyRelative = `screenshots/${legacyName}`;
    const legacyAbsolute = resolve(ROOT, legacyRelative);
    await page.screenshot({
      path: legacyAbsolute,
      fullPage: true,
      type: "png",
      animations: "disabled",
      caret: "hide",
    });
    const legacyMetadata = await sharp(legacyAbsolute).metadata();
    const legacyStat = await stat(legacyAbsolute);
    if (legacyMetadata.width !== viewport.width) {
      throw new Error(
        `Feil bredde på ${legacyRelative}: forventet ${viewport.width}, ` +
          `fikk ${legacyMetadata.width}.`,
      );
    }
    if (!legacyMetadata.height || legacyMetadata.height < viewport.height) {
      throw new Error(
        `Feil høyde på ${legacyRelative}: forventet minst ${viewport.height}, ` +
          `fikk ${legacyMetadata.height ?? 0}.`,
      );
    }
    result.legacy = {
      file: legacyRelative,
      width: legacyMetadata.width,
      height: legacyMetadata.height,
      bytes: legacyStat.size,
      capturedAt,
    };
  }

  return result;
}

async function openPage(browser, device, storageState) {
  const context = await browser.newContext({
    ...device,
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return { context, page };
}

function captureError(entry, viewport, error) {
  return {
    error: error instanceof Error ? error.message : String(error),
    capturedAt: new Date().toISOString(),
    route: entry.route,
    slug: entry.slug,
    viewport: viewport.key,
  };
}

async function main() {
  const { connectionString, schema } = resolveDatabaseUrl();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }, { schema }),
  });

  await waitForReady();
  const fixtures = await resolveFixtures(prisma);
  const routes = buildRoutes(fixtures);

  const duplicates = routes
    .map((entry) => entry.slug)
    .filter((slug, index, all) => all.indexOf(slug) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Dupliserte slug-navn: ${[...new Set(duplicates)].join(", ")}`);
  }

  // Rydd bare våre egne output-mapper, slik at gamle/foreldede bilder ikke
  // blir stående igjen og se ut som ferske fangster.
  await rm(resolve(PAGES_DIR, "desktop"), { recursive: true, force: true });
  await rm(resolve(PAGES_DIR, "mobile"), { recursive: true, force: true });
  await mkdir(resolve(PAGES_DIR, "desktop"), { recursive: true });
  await mkdir(resolve(PAGES_DIR, "mobile"), { recursive: true });
  await Promise.all(
    LEGACY_SCREENSHOTS.map((name) =>
      unlink(resolve(SCREENSHOT_DIR, name)).catch(() => {}),
    ),
  );

  const packageJson = JSON.parse(
    await readFile(resolve(ROOT, "package.json"), "utf8"),
  );

  console.log(
    `Tar komplette skjermbilder fra ${BASE_URL} → ${relative(ROOT, PAGES_DIR)}`,
  );
  console.log(
    `Fangster: ${routes.length} ruter × 2 viewports, ` +
      `${SKIPPED_ROUTES.length} eksplisitt hoppet over.\n`,
  );

  // Full Chromium viser PDF-forhåndsvisningen i rapportviseren. Playwrights
  // headless shell gjør ikke det, så vi prøver full Chromium først og faller
  // tilbake til standardoppsettet dersom kanalen ikke finnes på maskinen.
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: "chromium",
      args: ["--lang=nb-NO"],
    });
  } catch {
    console.warn(
      "… fant ikke full Chromium; bruker Playwrights standard nettleser. " +
        "PDF-forhåndsvisninger kan bli tomme.",
    );
    browser = await chromium.launch({
      headless: true,
      args: ["--lang=nb-NO"],
    });
  }

  const sessions = {};
  const openPages = [];
  const results = routes.map((entry) => ({
    route: entry.route,
    slug: entry.slug,
    role: entry.role,
    title: entry.title,
    note: entry.note ?? null,
    special: Boolean(entry.special),
    desktop: null,
    mobile: null,
  }));
  const legacyScreenshots = [];
  const redirectChecks = [];
  const failures = [];

  try {
    for (const [role, credentials] of Object.entries(CREDENTIALS)) {
      console.log(`Logger inn ${role} (${credentials.email}) …`);
      sessions[role] = await login(browser, credentials);
    }

    async function pageFor(viewport, role) {
      const key = `${viewport.key}:${role}`;
      if (!openPages[key]) {
        openPages[key] = await openPage(
          browser,
          viewport.device,
          role === "public" ? null : sessions[role],
        );
      }
      return openPages[key].page;
    }

    // Verifiser redirect-ruter før selve fangsten. Dette dokumenterer også
    // hvorfor enkelte page.tsx-ruter er hoppet over.
    for (const check of REDIRECT_CHECKS) {
      // Bruk en egen side med samme økt for redirect-sjekkene. Da kan ikke en
      // tidligere side i samme kontekst påvirke innloggingen.
      const isolated = await openPage(
        browser,
        DESKTOP.device,
        check.role === "public" ? null : sessions[check.role],
      );
      const page = isolated.page;
      try {
        const result = await checkRedirect(page, check);
        redirectChecks.push(result);
        console.log(
          `${result.pass ? "✔" : "✖"} redirect ${check.from} → ` +
            `${result.finalPath}${result.finalSearch}`,
        );
        if (!result.pass) {
          failures.push({
            scope: "redirect",
            route: check.from,
            error:
              `Forventet ${check.expectedPath}` +
              `${check.expectedSearch ? `?${new URLSearchParams(check.expectedSearch)}` : ""}, ` +
              `fikk ${result.finalPath}${result.finalSearch}.`,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ scope: "redirect", route: check.from, error: message });
        console.error(`✖ redirect ${check.from}: ${message}`);
      } finally {
        await isolated.context.close();
      }
    }

    for (const viewport of [DESKTOP, MOBILE]) {
      console.log(`\n--- ${viewport.key.toUpperCase()} ${viewport.width}×${viewport.height} ---`);
      for (const entry of routes) {
        const result = results.find(
          (candidate) =>
            candidate.slug === entry.slug && candidate.route === entry.route,
        );
        const page = await pageFor(viewport, entry.role);
        try {
          const capture = await captureRoute(page, entry, viewport);
          result[viewport.key] = capture;
          if (capture.legacy) legacyScreenshots.push(capture.legacy);
          console.log(
            `✔ ${viewport.key.padEnd(7)} ${entry.slug.padEnd(34)} ` +
              `${capture.width}×${capture.height} ${formatBytes(capture.bytes)}`,
          );
        } catch (error) {
          const failure = captureError(entry, viewport, error);
          result[viewport.key] = failure;
          failures.push({
            scope: "capture",
            route: entry.route,
            viewport: viewport.key,
            error: failure.error,
          });
          console.error(
            `✖ ${viewport.key} ${entry.slug}: ${failure.error}`,
          );
        }
      }
    }
  } finally {
    await Promise.all(
      Object.values(openPages).map(({ context }) => context.close()),
    );
    await browser.close();
    await prisma.$disconnect();
  }

  const finishedAt = new Date().toISOString();
  const captureCount = results.reduce(
    (total, entry) =>
      total +
      (entry.desktop && !entry.desktop.error ? 1 : 0) +
      (entry.mobile && !entry.mobile.error ? 1 : 0),
    0,
  );
  const totalBytes = results.reduce((total, entry) => {
    for (const key of ["desktop", "mobile"]) {
      const capture = entry[key];
      if (capture?.bytes) total += capture.bytes;
    }
    return total;
  }, 0) + legacyScreenshots.reduce((total, shot) => total + shot.bytes, 0);

  const manifest = {
    version: 1,
    generatedAt: finishedAt,
    appVersion: packageJson.version,
    baseUrl: BASE_URL,
    database: "fsm_ui_e2e (isolert E2E-database)",
    fixtures: {
      customerId: fixtures.customerId,
      workOrderId: fixtures.detailOrderId,
      reportedWorkOrderId: fixtures.reportedOrderId,
      reportId: fixtures.reportId,
      productId: fixtures.productId,
      documentId: fixtures.documentId,
      folderId: fixtures.folderId,
      templateId: fixtures.templateId,
    },
    viewports: {
      desktop: { width: DESKTOP.width, height: DESKTOP.height },
      mobile: { width: MOBILE.width, height: MOBILE.height },
    },
    counts: {
      routes: routes.length,
      captures: captureCount,
      expectedCaptures: routes.length * 2,
      skippedRoutes: SKIPPED_ROUTES.length,
      legacyScreenshots: legacyScreenshots.length,
      failures: failures.length,
    },
    captures: results,
    skipped: SKIPPED_ROUTES,
    redirectChecks,
    checks: {
      login:
        results.find((entry) => entry.slug === "logg-inn")?.desktop ?? null,
      notFound:
        results.find((entry) => entry.slug === "404-finnes-ikke")?.desktop ??
        null,
      usersRedirect:
        results.find((entry) => entry.slug === "brukere")?.desktop ?? null,
      twoFactorRedirect:
        redirectChecks.find((check) => check.from === "/logg-inn/2fa") ?? null,
    },
    legacyScreenshots,
    failures,
  };

  await writeFile(
    resolve(PAGES_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log("\n--- Oppsummering ---");
  console.log(`Ruter: ${routes.length}`);
  console.log(`Fangster: ${captureCount}/${routes.length * 2}`);
  console.log(`Hoppet over: ${SKIPPED_ROUTES.length} (se manifest.json)`);
  console.log(`README-bilder: ${legacyScreenshots.length}/${LEGACY_SCREENSHOTS.length}`);
  console.log(`Feil: ${failures.length}`);
  console.log(`Sidebilder totalt: ${formatBytes(totalBytes)}`);
  console.log(`Manifest: ${relative(ROOT, resolve(PAGES_DIR, "manifest.json"))}`);

  if (failures.length > 0) {
    console.error("\n✖ Noen sider ble ikke fanget:");
    for (const failure of failures) {
      console.error(
        `  - ${failure.scope} ${failure.route}${failure.viewport ? ` (${failure.viewport})` : ""}: ${failure.error}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log("\n✔ Alle sider er fanget uten feil.");
  }
}

main().catch(async (error) => {
  console.error("\n✖ Skjermbildefangsten feilet.");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
