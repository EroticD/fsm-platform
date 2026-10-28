#!/usr/bin/env node
/**
 * Kjører Lighthouse (mobil) mot én eller flere sider og krever at
 * tilgjengelighetsscoren er >= terskelen (standard 0.95).
 *
 *   npm run test:lighthouse
 *   LIGHTHOUSE_URLS="http://localhost:3000/logg-inn,http://localhost:3000/oppdrag" \
 *     npm run test:lighthouse
 *
 * Sider som krever innlogging kan auditeres ved å sette
 * LIGHTHOUSE_AUTH_EMAIL og LIGHTHOUSE_AUTH_PASSWORD. Skriptet logger da inn
 * med Playwright før Lighthouse kjører, og gjenbruker informasjonskapslene.
 * CHROME_PATH kan peke på en Chromium-installasjon.
 */
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const DEFAULT_URL = "http://localhost:3000/logg-inn";
const configuredThreshold = Number(
  process.env.LIGHTHOUSE_A11Y_THRESHOLD ?? "0.95",
);
const threshold =
  Number.isFinite(configuredThreshold) &&
  configuredThreshold > 0 &&
  configuredThreshold <= 1
    ? configuredThreshold
    : 0.95;

function urlsFromEnvironment() {
  const values = [
    ...process.argv.slice(2).filter((value) => !value.startsWith("-")),
    ...(process.env.LIGHTHOUSE_URLS ?? "").split(/[\s,]+/),
    ...(process.env.LIGHTHOUSE_URL ?? "").split(/[\s,]+/),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? [...new Set(values)] : [DEFAULT_URL];
}

async function loginCookieHeader(origin, email, password) {
  // Lastes først når autentisering faktisk er konfigurert, slik at lokal
  // kjøring uten testkonto ikke krever en installert Playwright-nettleser.
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(new URL("/logg-inn", origin).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-post", { exact: true }).fill(email);
    await page.getByLabel("Passord", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Logg inn" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"), {
      timeout: 20_000,
    });

    const cookies = await context.cookies(origin);
    if (cookies.length === 0) {
      throw new Error(`Innlogging mot ${origin} ga ingen informasjonskapsler.`);
    }
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

const urls = urlsFromEnvironment();
const email = process.env.LIGHTHOUSE_AUTH_EMAIL;
const password = process.env.LIGHTHOUSE_AUTH_PASSWORD;
const cookieByOrigin = new Map();
let failed = false;

const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROME_PATH,
  chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
});

try {
  for (const url of urls) {
    const origin = new URL(url).origin;
    let cookieHeader = cookieByOrigin.get(origin);

    if (email && password) {
      if (!cookieHeader) {
        cookieHeader = await loginCookieHeader(origin, email, password);
        cookieByOrigin.set(origin, cookieHeader);
      }
    } else {
      cookieHeader = process.env.LIGHTHOUSE_COOKIE;
    }

    const result = await lighthouse(url, {
      port: chrome.port,
      output: "json",
      onlyCategories: ["accessibility"],
      formFactor: "mobile",
      screenEmulation: {
        mobile: true,
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
      },
      ...(cookieHeader ? { extraHeaders: { Cookie: cookieHeader } } : {}),
    });

    const score = result?.lhr?.categories?.accessibility?.score;
    if (typeof score !== "number") {
      console.error(`✖ Lighthouse ga ingen tilgjengelighetsscore for ${url}.`);
      failed = true;
      continue;
    }

    const percent = Math.round(score * 100);
    console.log(`Lighthouse accessibility: ${percent}/100 (${url})`);

    if (score < threshold) {
      console.error(
        `✖ Lighthouse a11y ${percent} er under kravet ${Math.round(
          threshold * 100,
        )} for ${url}.`,
      );
      failed = true;
    }
  }
} catch (error) {
  console.error("✖ Lighthouse-kjøringen feilet:", error);
  failed = true;
} finally {
  await chrome.kill();
}

if (failed) {
  process.exitCode = 1;
}
