import { expect, test } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Språkvelgeren skal bytte hele katalogen uten URL-prefiks. Testen rører bare
 * cookie-tilstanden i sin egen nettleserkontekst.
 */
test("admin: bytter mellom norsk, tysk og polsk", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  expect(await loginAsRole(page, "admin")).toBe(true);

  const language = page.locator("select").first();
  await language.selectOption("de");
  await expect(page.getByRole("heading", { name: "Planung" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Aufträge", exact: true })).toBeVisible();

  await language.selectOption("pl");
  await expect(page.getByRole("heading", { name: "Planowanie" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zlecenia", exact: true })).toBeVisible();

  await language.selectOption("nb");
  await expect(page.getByRole("heading", { name: "Planlegging" })).toBeVisible();
});
