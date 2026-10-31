import { expect, test, type Page } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Fokusert mobiltest for hurtigfullføring. Den muterer ingenting: den bruker
 * bare et tomt, uvurdert skjema til å bekrefte at sveip/knapp gir en
 * tilgjengelig forklaring i stedet for å godkjenne en ufullstendig enhet.
 */
test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
});

async function findReportFormHref(page: Page): Promise<string | null> {
  await page.goto("/mine-oppdrag");
  const hrefs = [
    ...new Set(
      (
        await page.locator('a[href^="/mine-oppdrag/"]').evaluateAll((links) =>
          links
            .map((link) => link.getAttribute("href"))
            .filter(
              (href): href is string =>
                Boolean(href) &&
                /^\/mine-oppdrag\/[^/]+$/.test(href ?? "") &&
                href !== "/mine-oppdrag/ny",
            ),
        )
      ).filter(Boolean),
    ),
  ].slice(0, 6);

  for (const href of hrefs) {
    await page.goto(href);
    const formLink = page.locator('a[href*="/skjema/"]').first();
    if ((await formLink.count()) === 0) continue;
    const formHref = await formLink.getAttribute("href");
    if (formHref) return formHref;
  }
  return null;
}

test("mobil: sveip og fullfør-knapp forklarer manglende sjekkpunkter", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !roleCredentials("technician"),
    "E2E_TECHNICIAN_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "technician")).toBe(true);

  const formHref = await findReportFormHref(page);
  if (!formHref) {
    test.skip(true, "Fant ikke noe oppdrag med rapportskjema");
    return;
  }

  await page.goto(formHref);
  const completeButton = page
    .getByRole("button", { name: "Fullfør enhet" })
    .first();
  await expect(completeButton).toBeVisible();
  await expect(
    page.getByText(/Sveip høyre/).first(),
  ).toBeVisible();

  const box = await completeButton.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

  // Bare et tomt og uvurdert skjema gir en deterministisk mangelfull enhet.
  const state = await page.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) return null;
    const statusChecked = [
      ...form.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name^="status__"]',
      ),
    ].some((input) => input.checked);
    const emptyRequired = [
      ...form.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input[required], textarea[required], select[required]"),
    ].filter((element) => {
      if (
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" || element.type === "radio")
      ) {
        return !element.checked;
      }
      return !element.value.trim();
    }).length;
    return { statusChecked, emptyRequired };
  });

  if (!state || state.statusChecked || state.emptyRequired === 0) {
    test.skip(true, "Fant ikke et tomt, uvurdert rapportskjema");
    return;
  }

  // Sveip høyre over enhetshodet. Terskelen er 84 px.
  const surface = page.locator('[data-swipe-complete="true"]').first();
  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  await page.mouse.move(surfaceBox!.x + 20, surfaceBox!.y + surfaceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    surfaceBox!.x + 130,
    surfaceBox!.y + surfaceBox!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  const explanation = page
    .getByRole("alert")
    .filter({ hasText: "Kan ikke fullføre" })
    .first();
  await expect(explanation).toBeVisible();
  await expect(
    page.locator('input[type="radio"][value="GODKJENT"]:checked'),
  ).toHaveCount(0);

  // Fallback-knappen skal gi samme forklaring og aldri endre status.
  await completeButton.click();
  await expect(explanation).toBeVisible();
  await expect(
    page.locator('input[type="radio"][value="GODKJENT"]:checked'),
  ).toHaveCount(0);
});
