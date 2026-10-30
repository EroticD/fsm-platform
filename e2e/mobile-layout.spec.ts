import { expect, test, type Page } from "@playwright/test";
import {
  loginAsAdmin,
  loginAsRole,
  roleCredentials,
} from "./helpers";

/**
 * Regresjonsvakt for de smaleste mobilbreddene. Sidene skal aldri gi
 * vannrett scrolling på dokumentnivå; brede tabeller skal være byttet ut med
 * kort eller ligge i egne, avgrensede scrollområder.
 */
const MOBILE_WIDTHS = [320, 375, 390];

const STATIC_ROUTES = [
  "/oppdrag/ny",
  "/varsler/innstillinger",
  "/kunder",
  "/hms",
  "/sok/analyse",
];

async function firstCustomerHref(page: Page) {
  await page.goto("/kunder");
  const hrefs = await page
    .locator('a[href^="/kunder/"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => Boolean(href)),
    );

  return hrefs.find((href) => /^\/kunder\/[^/]+$/.test(href)) ?? null;
}

const CUSTOMER_PORTAL_ROUTES = [
  "/kundeportal",
  "/kundeportal/bestillinger",
  "/kundeportal/rapporter",
  "/kundeportal/dokumenter",
  "/kundeportal/utstyr",
  "/kundeportal/avtaler",
  "/kundeportal/besok",
  "/kundeportal/meldinger",
  "/kundeportal/kontakt",
];

for (const width of MOBILE_WIDTHS) {
  test(`kundeportalen uten sideoverflow ved ${width}px`, async ({ page }) => {
    test.skip(
      !roleCredentials("customer"),
      "E2E_CUSTOMER-konto mangler",
    );
    expect(await loginAsRole(page, "customer")).toBe(true);
    await page.setViewportSize({ width, height: 800 });

    for (const route of CUSTOMER_PORTAL_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1").first()).toBeVisible();
      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
      });
      expect(
        metrics.scrollWidth,
        `${route} ved ${width}px: ${metrics.scrollWidth}px > ${metrics.clientWidth}px`,
      ).toBeLessThanOrEqual(metrics.clientWidth);
    }
  });
}

for (const width of MOBILE_WIDTHS) {
  test(`ingen vannrett sideoverflow ved ${width}px`, async ({ page }) => {
    test.skip(!roleCredentials("admin"), "E2E_ADMIN-konto mangler");
    await loginAsAdmin(page);
    await page.setViewportSize({ width, height: 800 });

    const customerHref = await firstCustomerHref(page);
    const routes = [
      ...STATIC_ROUTES,
      ...(customerHref ? [customerHref, `${customerHref}/rediger`] : []),
    ];

    for (const route of routes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1").first()).toBeVisible();

      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        return {
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          innerWidth: window.innerWidth,
        };
      });

      expect(
        metrics.scrollWidth,
        `${route} ved ${width}px: ${metrics.scrollWidth}px > ${metrics.clientWidth}px`,
      ).toBeLessThanOrEqual(metrics.clientWidth);

      if (process.env.MOBILE_LAYOUT_METRICS) {
        console.log(
          `[mobile-layout] ${width}px ${route} scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth} innerWidth=${metrics.innerWidth}`,
        );
      }
    }
  });
}
