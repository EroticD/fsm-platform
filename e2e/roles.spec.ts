import { expect, test, type Page } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Rollebaserte tester mot den fiktive E2E-databasen (scripts/seed-e2e.mjs).
 *
 * Testene muterer ingenting. De hopper over når rollekontoen ikke er satt,
 * slik at en lokal kjøring uten .env.e2e.local fortsatt er grønn.
 */

const OFFICE_CREDENTIALS_MISSING =
  "E2E_OFFICE_EMAIL/PASSWORD er ikke satt";
const TECHNICIAN_CREDENTIALS_MISSING =
  "E2E_TECHNICIAN_EMAIL/PASSWORD er ikke satt";
const CUSTOMER_CREDENTIALS_MISSING =
  "E2E_CUSTOMER_EMAIL/PASSWORD er ikke satt";
const ADMIN_CREDENTIALS_MISSING = "E2E_ADMIN_EMAIL/PASSWORD er ikke satt";

const SETTINGS_PATH = "/innstillinger";
// Appen har ingen egen /innstillinger/brukere-rute. Ansatteadministrasjonen
// ligger i Innstillinger-fanen, og /brukere er den kompatible omdirigeringen.
const USERS_SETTINGS_PATH = "/innstillinger?tab=ansatte";

/**
 * Åpner hamburgermenyen og returnerer dialogen. Menyen er den eneste
 * navigasjonsflaten som inneholder Innstillinger.
 */
async function openAppMenu(page: Page) {
  await page.getByRole("button", { name: "Åpne menyen" }).click();
  const dialog = page.getByRole("dialog", { name: "Meny" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("office: dashbord, oppdrag, kunder, dokumenter og rapporter", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("office"), OFFICE_CREDENTIALS_MISSING);
  expect(await loginAsRole(page, "office")).toBe(true);

  // Hovednavigasjonen er bare synlig på brede skjermer.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("heading", { name: /Planlegging/ })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Hovedmeny" })
      .getByRole("link", { name: /Dashbord/ }),
  ).toBeVisible();

  await page.goto("/oppdrag");
  await expect(
    page
      .getByRole("link", { name: "Service – automatiske dører" })
      .first(),
  ).toBeVisible();

  await page.goto("/kunder");
  await expect(
    page.getByRole("link", { name: /Nordvik Testindustri AS/ }),
  ).toBeVisible();

  // De seedede dokumentene ligger i undermapper. Åpne den første mappen og
  // kontroller at dokumentlisten faktisk viser et dokument der.
  await page.goto("/dokumenter");
  const folderLink = page.getByRole("link", { name: /Driftshåndbøker/ });
  await expect(folderLink).toBeVisible();
  await folderLink.click();

  const documentsHeading = page.getByRole("heading", {
    name: /^Dokumenter \(\d+\)$/i,
  });
  await expect(documentsHeading).toBeVisible();
  // Vent på at mappevisningen faktisk er ferdig oppdatert før tellingen leses.
  await expect(documentsHeading).toContainText(/\([1-9]\d*\)/);
  await expect(
    page.getByRole("link", { name: /Åpne PDF/ }).first(),
  ).toBeVisible();

  // «alle» gjør rapporttesten uavhengig av hvilken måned den seedede
  // rapporten ble fullført i.
  await page.goto("/rapporter?vis=alle");
  await expect(
    page.getByRole("heading", { name: "Servicerapporter" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Åpne", exact: true }).first(),
  ).toBeVisible();
});

test("office: innstillinger ligger bare i menyen, og ansattefanen er tilgjengelig", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("office"), OFFICE_CREDENTIALS_MISSING);
  expect(await loginAsRole(page, "office")).toBe(true);

  // Ansatteadministrasjonen ligger i Innstillinger. Den gamle /brukere-adressen
  // skal fortsatt fungere som en kompatibel inngang for kontoret.
  await page.goto("/brukere");
  await expect(page).toHaveURL(/\/innstillinger\?tab=ansatte/);
  await expect(
    page.getByRole("heading", { name: "Alle brukere i systemet" }),
  ).toBeVisible();

  // Bred skjerm: hovednavigasjonen har arbeidsområdene, men ikke Innstillinger.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const primaryNav = page
    .getByRole("navigation", { name: "Hovedmeny" })
    .first();
  await expect(primaryNav).toBeVisible();
  await expect(primaryNav.getByRole("link")).toHaveCount(5);
  await expect(
    primaryNav.getByRole("link", { name: /Innstillinger/ }),
  ).toHaveCount(0);

  let dialog = await openAppMenu(page);
  await expect(
    dialog.getByRole("link", { name: /Innstillinger/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Smal skjerm: hovednavigasjonen er skjult, men Innstillinger er fortsatt
  // tilgjengelig i hamburgermenyen.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Meny" }),
  ).toHaveCount(0);

  dialog = await openAppMenu(page);
  await expect(
    dialog.getByRole("link", { name: /Innstillinger/ }),
  ).toBeVisible();
});

test("technician: dagens oppdrag viser sjekkliste og riktige statusvalg", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("technician"), TECHNICIAN_CREDENTIALS_MISSING);
  expect(await loginAsRole(page, "technician")).toBe(true);

  await page.goto("/mine-oppdrag");
  await expect(
    page.getByRole("heading", { name: "Service – automatiske dører" }),
  ).toBeVisible();
  // Heroen er en egen lenke til skjemaet; hent oppdrags-id-en og gå til
  // detaljsiden for å verifisere statusvalgene.
  const heroCta = page
    .getByRole("link", { name: /Start skjema|Fortsett skjema/ })
    .first();
  const href = await heroCta.getAttribute("href");
  const workOrderId = href?.match(/\/mine-oppdrag\/([^/]+)\//)?.[1];
  expect(workOrderId).toBeTruthy();
  await page.goto(`/mine-oppdrag/${workOrderId}`);
  await expect(
    page.getByRole("heading", { name: "Service – automatiske dører" }),
  ).toBeVisible();

  const checklistAction = page
    .getByRole("link", {
      name: /Fyll ut skjema|Start skjema|Fortsett skjema/,
    })
    .first();
  await expect(checklistAction).toBeVisible();
  await expect(checklistAction).toHaveAttribute("href", /\/skjema\//);

  // Statusvelgeren har ingen egen etikett; finn den via det gjeldende
  // PLANNED-valget i stedet for en CSS-selektor.
  const statusSelect = page
    .getByRole("combobox")
    .filter({
      has: page.getByRole("option", {
        name: /Planlagt \(Nåværende status\)/,
      }),
    });
  await expect(statusSelect).toBeVisible();
  await expect(statusSelect).toHaveValue("PLANNED");

  // Regresjon: PLANNED skal tilby «Venter på kunde» (WAITING), ikke
  // «Venter på planlegging» (PENDING). PENDING er systemets startstatus og
  // skal ikke kunne velges manuelt.
  await expect(
    statusSelect.getByRole("option", { name: "Venter på kunde" }),
  ).toHaveAttribute("value", "WAITING");
  await expect(
    statusSelect.getByRole("option", { name: /Venter på planlegging/ }),
  ).toHaveCount(0);
});

test("technician: brukeradministrasjon er sperret, men egne innstillinger er tilgjengelig", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("technician"), TECHNICIAN_CREDENTIALS_MISSING);
  expect(await loginAsRole(page, "technician")).toBe(true);

  // Den gamle /brukere-adressen skal ikke bli stående. Teknikeren mangler
  // users.view, så ansattefanen skal heller ikke rendres.
  await page.goto("/brukere");
  await expect(page).not.toHaveURL(/\/brukere$/, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Alle brukere i systemet" }),
  ).toHaveCount(0);

  await page.goto(USERS_SETTINGS_PATH);
  await expect(
    page.getByRole("heading", { name: "Alle brukere i systemet" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Innstillinger" })
      .getByRole("link", { name: /Ansatte & Roller/ }),
  ).toHaveCount(0);

  // Dispatch og kapasitet krever workorders.assign, som montøren ikke har.
  await page.goto("/kalender/dispatch");
  await expect(page).not.toHaveURL(/\/kalender\/dispatch/);
  await page.goto("/kalender/kapasitet");
  await expect(page).not.toHaveURL(/\/kalender\/kapasitet/);

  // Teknikeren har templates.view/reports.view, så Innstillinger skal finnes –
  // men bare med de fanene rollen faktisk har tilgang til.
  const dialog = await openAppMenu(page);
  await expect(
    dialog.getByRole("link", { name: /Innstillinger/ }),
  ).toHaveAttribute("href", "/innstillinger");
});

test("customer: egen portal, avviste ansattflater og ingen horisontal scroll", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("customer"), CUSTOMER_CREDENTIALS_MISSING);
  expect(await loginAsRole(page, "customer")).toBe(true);

  await expect(
    page.getByRole("heading", { name: /Min Bedrift: Nordvik Testindustri AS/ }),
  ).toBeVisible();
  // Kundeportalen kan vises på / eller /kundeportal avhengig av redirect.
  expect(new URL(page.url()).pathname).toMatch(/^\/(kundeportal)?$/);
  await expect(page.getByText("Nordvik Testindustri AS").first()).toBeVisible();
  await expect(page.getByText("Fjordlys Montasje AS")).toHaveCount(0);

  // Ansattflater skal sende kunden tilbake til portalen.
  await page.goto("/oppdrag");
  await expect(
    page.getByRole("heading", { name: /Min Bedrift: Nordvik Testindustri AS/ }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/(kundeportal)?$/);

  await page.goto("/dokumenter");
  await expect(
    page.getByRole("heading", { name: /Min Bedrift: Nordvik Testindustri AS/ }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/(kundeportal)?$/);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/kundeportal");
  await expect(
    page.getByRole("heading", { name: /Min Bedrift: Nordvik Testindustri AS/ }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "kundeportalen har horisontal scroll på 375px").toBeLessThanOrEqual(
    1,
  );
});

test("admin: menyen er en dialog med lydbryter og innstillinger nederst", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("admin"), ADMIN_CREDENTIALS_MISSING);
  expect(await loginAsRole(page, "admin")).toBe(true);

  await page.goto("/");
  const dialog = await openAppMenu(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const soundToggle = dialog.getByRole("button", { name: /varsellyd/i });
  await expect(soundToggle).toBeVisible();

  const settingsLink = dialog.getByRole("link", { name: /Innstillinger/ });
  await expect(settingsLink).toBeVisible();
  await expect(settingsLink).toHaveAttribute("href", SETTINGS_PATH);

  // Innstillinger ligger i den fastlåste bunnseksjonen, etter lydbryteren,
  // og skal derfor være den siste lenken i dialogen.
  await expect(dialog.getByRole("link").last()).toHaveText(/Innstillinger/);
});
