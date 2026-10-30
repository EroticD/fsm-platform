import { expect, test } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Språkvelgeren ligger i hamburgermenyen. Testen rører bare cookie-tilstanden i
 * sin egen nettleserkontekst.
 */
test("admin: bytter mellom norsk, tysk og polsk", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  expect(await loginAsRole(page, "admin")).toBe(true);

  const openLanguageMenu = async () => {
    await page.locator('button[aria-controls="app-navigation"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    return dialog.locator("select").first();
  };

  let language = await openLanguageMenu();
  await language.selectOption("de");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Planung" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Aufträge", exact: true })).toBeVisible();

  language = await openLanguageMenu();
  await language.selectOption("pl");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Planowanie" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zlecenia", exact: true })).toBeVisible();

  language = await openLanguageMenu();
  await language.selectOption("nb");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Planlegging" })).toBeVisible();
});
