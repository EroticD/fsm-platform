import { expect, test } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Read-only kontroll av at kalenderen, kontorsiden og feltflaten bruker
 * visittene og ikke de gamle oppdragsdatofeltene. Testen muterer ingenting,
 * slik at den kan kjøres parallelt med resten av matrisen.
 */
test("office: timegrid og visittplanlegging vises", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("office"), "E2E_OFFICE_EMAIL/PASSWORD er ikke satt");
  expect(await loginAsRole(page, "office")).toBe(true);

  await page.goto("/kalender?vis=timegrid");
  await expect(
    page.getByRole("link", { name: "Uke (time)", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Service – automatiske dører").first()).toBeVisible();

  await page.goto("/kalender?vis=dag");
  await expect(
    page.getByRole("link", { name: "Dag", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.goto("/oppdrag");
  await page
    .getByRole("link", { name: /Service – automatiske dører/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Service – automatiske dører" }),
  ).toBeVisible();
  await expect(page.getByText("Planlegging", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Hele dagen").first()).toBeVisible();
});

test("technician: feltkortet viser visitt og statusflyt", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(
    !roleCredentials("technician"),
    "E2E_TECHNICIAN_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "technician")).toBe(true);

  await page.goto("/mine-oppdrag");
  const detailHref = await page
    .locator('a[href^="/mine-oppdrag/"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .find((href) => /^\/mine-oppdrag\/[a-z0-9]+$/.test(href ?? "")),
    );
  expect(detailHref).toBeTruthy();
  await page.goto(detailHref!);

  await expect(page.getByText(/dagens visitt|neste visitt/i).first()).toBeVisible();
  await expect(page.getByText("Hele dagen").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Start kjøring|På stedet|Fullfør/ }).first(),
  ).toBeVisible();
});
