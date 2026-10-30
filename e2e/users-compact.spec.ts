import { expect, test } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

const ADMIN_CREDENTIALS_MISSING = "E2E_ADMIN_EMAIL/PASSWORD er ikke satt";

/**
 * Regresjonstest for de kompakte listene: hver ansatt og rolle skal være en
 * `<details>`-rad på minst 44 px, og skjemaene skal først bli synlige når
 * raden åpnes – både med mus og tastatur.
 */
test("admin: ansatte og roller er kompakte details-rader", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!roleCredentials("admin"), ADMIN_CREDENTIALS_MISSING);
  expect(await loginAsRole(page, "admin")).toBe(true);

  await page.goto("/innstillinger?tab=ansatte");
  const userRows = page.locator("[data-user-row]");
  await expect(userRows.first()).toBeVisible();

  const firstUser = userRows.first();
  const firstSummary = firstUser.locator("summary");
  const summaryHeight = await firstSummary.evaluate((element) =>
    Math.round(element.getBoundingClientRect().height),
  );
  expect(summaryHeight).toBeGreaterThanOrEqual(44);
  expect(await firstUser.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  await expect(firstUser.locator("form:visible")).toHaveCount(0);

  await firstSummary.focus();
  await page.keyboard.press("Enter");
  expect(await firstUser.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
  await expect(firstUser.locator("form:visible").first()).toBeVisible();

  await page.keyboard.press("Space");
  expect(await firstUser.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);

  if ((await userRows.count()) > 1) {
    const secondUser = userRows.nth(1);
    await secondUser.locator("summary").click();
    expect(await secondUser.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
    await expect(secondUser.locator("form:visible").first()).toBeVisible();
    await expect(firstUser.locator("form:visible")).toHaveCount(0);
    await secondUser.locator("summary").click();
  }

  await page.goto("/innstillinger?tab=roller");
  const roleRows = page.locator("[data-role-row]");
  await expect(roleRows.first()).toBeVisible();

  const firstRole = roleRows.first();
  const roleSummary = firstRole.locator("summary");
  const roleSummaryHeight = await roleSummary.evaluate((element) =>
    Math.round(element.getBoundingClientRect().height),
  );
  expect(roleSummaryHeight).toBeGreaterThanOrEqual(44);
  await expect(firstRole.locator("form:visible")).toHaveCount(0);

  await roleSummary.focus();
  await page.keyboard.press("Enter");
  expect(await firstRole.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
  await expect(firstRole.locator("form:visible").first()).toBeVisible();
});
