import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAsAdmin } from "./helpers";

const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

async function expectNoBlockingA11yIssues(page: Parameters<typeof loginAsAdmin>[0]) {
  // Next dev kan sende en fast-refresh-reload rett etter første rendering.
  // Vent til nettverket er rolig, og prøv analysen én gang til hvis
  // kjøringskonteksten ble revet ned av en navigasjon.
  let results:
    | Awaited<ReturnType<InstanceType<typeof AxeBuilder>["analyze"]>>
    | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    try {
      results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(500);
    }
  }
  if (!results) throw new Error("Axe-analysen ga ingen resultat");
  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ""),
  );
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target),
    })),
  ).toEqual([]);
}

test("innloggingssiden har ingen kritiske a11y-brudd", async ({ page }) => {
  await page.goto("/logg-inn");
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
  await expectNoBlockingA11yIssues(page);
});

test("hovedflatene har ingen kritiske a11y-brudd", async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  for (const path of [
    "/",
    "/kunder",
    "/dokumenter",
    "/innstillinger",
    "/varsler",
    "/kart",
    "/kalender",
    "/kalender/maned",
  ]) {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    await expectNoBlockingA11yIssues(page);
  }
});

test("skjemaer for oppretting og redigering er tilgjengelige", async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  for (const path of ["/oppdrag/ny", "/mine-oppdrag/ny"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectNoBlockingA11yIssues(page);
  }

  // Redigeringssiden for et eksisterende oppdrag. Uten oppdrag i databasen
  // hopper vi over, slik at testen er stabil i en tom testdatabase.
  await page.goto("/oppdrag");
  const link = page
    .locator('a[href^="/oppdrag/"]:not([href="/oppdrag/ny"]):not([href^="/oppdrag/ny/"])')
    .first();
  const href = await link.getAttribute("href").catch(() => null);
  test.skip(!href || href === "/oppdrag/ny", "Fant ingen oppdrag å redigere");
  await page.goto(`${href}/rediger`);
  await expect(page.locator("main")).toBeVisible();
  await expectNoBlockingA11yIssues(page);
});

test("innstillinger for ansatte og maler er tilgjengelige", async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  for (const path of [
    "/innstillinger?tab=ansatte",
    "/innstillinger?tab=maler",
    "/innstillinger?tab=roller",
  ]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectNoBlockingA11yIssues(page);
  }
});

test("rapportskjemaet er tilgjengelig når det finnes et oppdrag med sjekkliste", async ({
  page,
}) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  const directPath = process.env.E2E_REPORT_PATH;
  if (directPath) {
    await page.goto(directPath);
    await expect(page.locator("main")).toBeVisible();
    await expectNoBlockingA11yIssues(page);
    return;
  }

  await page.goto("/mine-oppdrag");
  const workOrderLink = page
    .locator('a[href^="/mine-oppdrag/"]')
    .filter({ hasNot: page.locator('[href="/mine-oppdrag"]') })
    .first();
  const workOrderHref = (await workOrderLink.count())
    ? await workOrderLink.getAttribute("href").catch(() => null)
    : null;
  if (!workOrderHref) {
    test.skip(true, "Fant ikke noe oppdrag med rapportskjema");
    return;
  }

  await page.goto(workOrderHref);
  const formLink = page.locator('a[href*="/skjema/"]').first();
  const formHref = (await formLink.count())
    ? await formLink.getAttribute("href").catch(() => null)
    : null;
  if (!formHref) {
    test.skip(true, "Oppdraget har ingen sjekkliste å fylle ut");
    return;
  }

  await page.goto(formHref);
  await expect(page.locator("main")).toBeVisible();
  await expectNoBlockingA11yIssues(page);
});

test("mobil meny er en merket dialog med fokusfelle", async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
  await page.setViewportSize({ width: 375, height: 812 });
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  const menuButton = page.locator('button[aria-controls="mobile-navigation"]');
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await menuButton.click();

  const dialog = page.getByRole("dialog", { name: /meny/i });
  await expect(dialog).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(menuButton).toHaveAttribute(
    "aria-controls",
    "mobile-navigation",
  );
  await expectNoBlockingA11yIssues(page);

  // Escape lukker menyen og setter fokus tilbake på åpneknappen.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();
});

test("mobil visning av innlogging har ikke horisontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/logg-inn");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("oppdrags- og kundelister har ikke horisontal scroll på mobil", async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/oppdrag", "/kunder"]) {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} har horisontal scroll`).toBeLessThanOrEqual(1);
  }
});
