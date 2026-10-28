#!/usr/bin/env node
/**
 * Tar ferske skjermbilder av den seedede demo-databasen.
 *
 * Skriptet starter ikke serveren selv. Forutsetter at produksjonsbygget kjører
 * mot en isolert database, for eksempel:
 *
 *   SCREENSHOT_BASE_URL=http://127.0.0.1:3100 \
 *     node scripts/capture-screenshots.mjs
 *
 * Kontoopplysningene kan overstyres med E2E_ADMIN_*, E2E_TECHNICIAN_* og
 * E2E_CUSTOMER_*. Standardverdiene er de seedede demokontoene.
 */
import { mkdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE_URL = (
  process.env.SCREENSHOT_BASE_URL || "http://127.0.0.1:3100"
).replace(/\/+$/, "");
const SCREENSHOT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "screenshots",
);

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

const DESKTOP = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: "nb-NO",
  timezoneId: "Europe/Oslo",
  colorScheme: "light",
};

const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "nb-NO",
  timezoneId: "Europe/Oslo",
  colorScheme: "light",
};

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
  /* Fullsidebilder skal ikke vise en fastlåst bunnlinje midt i innholdet. */
  .sticky.bottom-0 {
    position: static !important;
    bottom: auto !important;
  }
  .fixed.inset-x-0.bottom-0.z-40 {
    display: none !important;
  }
`;

function urlFor(path) {
  return new URL(path, `${BASE_URL}/`).href;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Titler i seeden kan bruke vanlig bindestrek eller tankestrek. Matcheren
 * godtar begge, slik at skriptet ikke er avhengig av tegnvalget i seeden.
 */
function titlePattern(title) {
  const parts = title
    .split(/\s*[–—-]\s*/)
    .map((part) => escapeRegExp(part.trim()))
    .filter(Boolean);
  return new RegExp(parts.join("\\s*[–—-]\\s*"), "i");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Venter til nettverket har roet seg. SSE-strømmen kan gjøre at det aldri skjer. */
async function waitForNetworkIdle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 6_000 });
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    // /api/events er en bevisst langvarig SSE-tilkobling. Når den holder
    // nettverket åpent, fortsetter vi etter load + fonter/bilder i stedet.
    console.warn("  … networkidle uteble (langvarig SSE); fortsetter etter last.");
  }
}

/** Slår av animasjoner, skjuler rullefelt og venter på fonter og bilder. */
async function settle(page) {
  await page.addStyleTag({ content: CAPTURE_CSS });

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // Lazy-lastede bilder kan mangle naturlig bredde. Vent kort, men ikke evig.
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      undefined,
      { timeout: 4_000 },
    )
    .catch(() => {});

  await page.evaluate(
    () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }),
  );

  // Kort stabilisering etter fonts/bilder. Suspense-innhold kan streames
  // like etter last, så vi gir tellinger og lister tid til å bli ferdige.
  await page.waitForTimeout(800);
}

async function assertRouteReady(page, heading, description) {
  const locator = page
    .getByRole("heading", { level: 1 })
    .filter({ hasText: heading })
    .first();

  try {
    await locator.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const headings = await page
      .getByRole("heading")
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `Forventet ${description} med overskrift «${heading}», men fant ` +
        `${headings.length > 0 ? headings.join(" | ") : "ingen overskrifter"} ` +
        `på ${page.url()}.`,
      { cause: error },
    );
  }
}

async function login(page, credentials) {
  const { email, password } = credentials;

  await page.goto(urlFor("/logg-inn"), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  await page.getByLabel("E-post", { exact: true }).fill(email);
  await page.getByLabel("Passord", { exact: true }).fill(password);

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
      `Innlogging feilet for ${email}. ` +
        (loginError
          ? `Vist feil: ${loginError}`
          : "Siden forlot ikke /logg-inn."),
      { cause: error },
    );
  }

  // Verifiser at økten faktisk tilhører kontoen, ikke bare at URL-en endret seg.
  const response = await page.request.get(urlFor("/api/auth/session"));
  if (!response.ok()) {
    throw new Error(
      `Innlogging for ${email} ga HTTP ${response.status()} fra /api/auth/session.`,
    );
  }

  const session = await response.json();
  const sessionEmail = session?.user?.email;
  if (
    typeof sessionEmail !== "string" ||
    sessionEmail.toLowerCase() !== email.toLowerCase()
  ) {
    throw new Error(
      `Innlogging for ${email} ga feil økt (fant ${sessionEmail ?? "ingen e-post"}).`,
    );
  }
}

async function gotoAndSettle(page, path) {
  await page.goto(urlFor(path), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  await waitForNetworkIdle(page);
}

/** Klikker en lenke og venter på at både URL og innhold er klart. */
async function openLink(page, link, label) {
  const href = await link.getAttribute("href");
  if (!href) {
    throw new Error(`Lenken «${label}» mangler href på ${page.url()}.`);
  }

  const target = new URL(href, `${BASE_URL}/`);

  try {
    await link.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === target.pathname && url.search === target.search,
        { timeout: 20_000 },
      ),
      link.click(),
    ]);
  } catch (error) {
    throw new Error(
      `Kunne ikke åpne ${label} (${target.pathname}${target.search}) fra ` +
        `${page.url()}.`,
      { cause: error },
    );
  }

  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  await waitForNetworkIdle(page);
}

async function clickTitle(
  page,
  title,
  description,
  { requireHeading = true } = {},
) {
  const link = page
    .getByRole("link", { name: titlePattern(title) })
    .first();

  try {
    await link.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const bodyText = await page
      .locator("main")
      .innerText()
      .catch(() => "");
    throw new Error(
      `Fant ikke lenken «${title}» (${description}) på ${page.url()}. ` +
        `Sideinnhold: ${bodyText.slice(0, 300) || "(tomt)"}`,
      { cause: error },
    );
  }

  await openLink(page, link, description);

  if (!requireHeading) {
    const marker = page.getByText(titlePattern(title)).first();
    try {
      await marker.waitFor({ state: "visible", timeout: 15_000 });
    } catch (error) {
      throw new Error(
        `Åpnet ${description}, men fant ikke «${title}» på ${page.url()}.`,
        { cause: error },
      );
    }
    return;
  }

  const heading = page
    .getByRole("heading", { level: 1 })
    .filter({ hasText: titlePattern(title) })
    .first();
  try {
    await heading.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const headings = await page
      .getByRole("heading")
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `Åpnet ${description}, men fant ikke overskrift «${title}» på ` +
        `${page.url()}. Overskrifter: ` +
        `${headings.length > 0 ? headings.join(" | ") : "(ingen)"}.`,
      { cause: error },
    );
  }
}

async function capture(page, filename) {
  await settle(page);

  const target = resolve(SCREENSHOT_DIR, filename);
  await page.screenshot({
    path: target,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });

  const { size } = await stat(target);
  if (size === 0) {
    throw new Error(`Skjermbildet ${filename} ble tomt.`);
  }

  console.log(`✔ ${relative(process.cwd(), target)} (${formatBytes(size)})`);
}

async function withSession(browser, device, credentials, callback) {
  const context = await browser.newContext(device);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await login(page, credentials);
    await callback(page);
  } finally {
    await context.close();
  }
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  console.log(`Tar skjermbilder fra ${BASE_URL} → ${SCREENSHOT_DIR}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--lang=nb-NO"],
  });

  try {
    // --- Desktop: administrator -------------------------------------------
    await withSession(browser, DESKTOP, CREDENTIALS.admin, async (page) => {
      await gotoAndSettle(page, "/");
      await assertRouteReady(page, /Velkommen/i, "dashbordet");
      await capture(page, "01-dashbord.png");

      await gotoAndSettle(page, "/oppdrag");
      await assertRouteReady(page, /Alle/i, "oppdragslisten");
      await capture(page, "02-oppdrag.png");

      await gotoAndSettle(page, "/oppdrag?q=Feils%C3%B8king");
      await clickTitle(
        page,
        "Feilsøking – portåpner",
        "oppdraget «Feilsøking – portåpner»",
      );
      await capture(page, "03-oppdrag-detalj.png");

      await gotoAndSettle(page, "/kalender?vis=maned");
      await assertRouteReady(page, /Månedskalender/i, "månedskalenderen");
      await capture(page, "04-kalender.png");

      await gotoAndSettle(page, "/kunder");
      await assertRouteReady(page, /Kundekatalog/i, "kundekatalogen");
      await capture(page, "05-kunder.png");

      await gotoAndSettle(page, "/kunder?q=Nordvik");
      await clickTitle(
        page,
        "Nordvik Testindustri AS",
        "kunden «Nordvik Testindustri AS»",
      );
      await capture(page, "06-kunde-detalj.png");

      await gotoAndSettle(page, "/dokumenter");
      await assertRouteReady(page, /Dokumentbibliotek/i, "dokumentbiblioteket");
      await capture(page, "07-dokumenter.png");

      await clickTitle(
        page,
        "Driftshåndbøker",
        "mappen «Driftshåndbøker»",
        { requireHeading: false },
      );
      await capture(page, "08-dokumenter-mappe.png");

      await gotoAndSettle(page, "/rapporter");
      await assertRouteReady(page, /Servicerapporter/i, "rapportlisten");
      await capture(page, "09-rapporter.png");

      // Faktiske fane-parametere fra SettingsTabs.tsx: sikkerhet og branding.
      await gotoAndSettle(page, "/innstillinger?tab=sikkerhet");
      await assertRouteReady(page, /Innstillinger/i, "sikkerhetsinnstillingene");
      await capture(page, "10-innstillinger-sikkerhet.png");

      await gotoAndSettle(page, "/innstillinger?tab=branding");
      await assertRouteReady(page, /Innstillinger/i, "merkevareinnstillingene");
      await capture(page, "11-innstillinger-merkevare.png");
    });

    // --- Mobil: administrator ---------------------------------------------
    await withSession(browser, MOBILE, CREDENTIALS.admin, async (page) => {
      await gotoAndSettle(page, "/");
      await assertRouteReady(page, /Velkommen/i, "mobildashbordet");
      await capture(page, "12-mobil-dashbord.png");
    });

    // --- Mobil: montør -----------------------------------------------------
    await withSession(browser, MOBILE, CREDENTIALS.technician, async (page) => {
      await gotoAndSettle(page, "/mine-oppdrag?q=automatiske");
      await clickTitle(
        page,
        "Service – automatiske dører",
        "oppdraget «Service – automatiske dører»",
      );
      await capture(page, "13-mobil-oppdrag.png");
    });

    // --- Desktop: kunde ----------------------------------------------------
    await withSession(browser, DESKTOP, CREDENTIALS.customer, async (page) => {
      await gotoAndSettle(page, "/kundeportal");
      await assertRouteReady(page, /Min Bedrift/i, "kundeportalen");
      await capture(page, "14-kundeportal.png");
    });

    // --- Mobil: kunde ------------------------------------------------------
    await withSession(browser, MOBILE, CREDENTIALS.customer, async (page) => {
      await gotoAndSettle(page, "/kundeportal");
      await assertRouteReady(page, /Min Bedrift/i, "mobil kundeportal");
      await capture(page, "15-kundeportal-mobil.png");
    });
  } finally {
    await browser.close();
  }

  console.log("\n✔ Alle 15 skjermbildene er oppdatert.");
}

main().catch((error) => {
  console.error("\n✖ Skjermbildeinnhentingen feilet.");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
