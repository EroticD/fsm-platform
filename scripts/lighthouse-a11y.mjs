#!/usr/bin/env node
/**
 * Kjører Lighthouse (mobil) mot en side og krever a11y-score >= 0.95.
 *
 *   LIGHTHOUSE_URL=http://localhost:3000/logg-inn npm run test:lighthouse
 *
 * Brukes lokalt eller i CI etter at appen kjører. CHROME_PATH kan peke på en
 * Chromium-installasjon.
 */
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const url = process.env.LIGHTHOUSE_URL ?? "http://localhost:3000/logg-inn";
const threshold = Number(process.env.LIGHTHOUSE_A11Y_THRESHOLD ?? "0.95");

const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROME_PATH,
  chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
});

try {
  const result = await lighthouse(url, {
    port: chrome.port,
    output: "json",
    onlyCategories: ["accessibility"],
    formFactor: "mobile",
    screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 },
  });

  const score = result?.lhr?.categories?.accessibility?.score ?? 0;
  const percent = Math.round(score * 100);
  console.log(`Lighthouse accessibility: ${percent}/100 (${url})`);

  if (score < threshold) {
    console.error(
      `✖ Lighthouse a11y ${percent} er under kravet ${Math.round(threshold * 100)}.`,
    );
    process.exitCode = 1;
  }
} finally {
  await chrome.kill();
}
