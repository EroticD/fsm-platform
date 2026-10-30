import { expect, test } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Kontorflaten skal kunne deles i to visninger via query-parameter:
 * `?vis=liste` (standard) og `?vis=tavle`. Testen muterer ingenting.
 */
test("office: bytter mellom liste og tavle på dashbordet", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(
    !roleCredentials("office"),
    "E2E_OFFICE_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "office")).toBe(true);

  await page.goto("/?vis=liste");
  await expect(
    page.getByRole("heading", { name: /Planlegging/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Liste", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Køen" })).toBeVisible();

  await page.getByRole("link", { name: "Tavle", exact: true }).click();
  await expect(page).toHaveURL(/[?&]vis=tavle/);

  for (const column of ["Forfalt", "I dag", "Pågår", "Ikke tildelt"]) {
    await expect(page.getByRole("region", { name: column, exact: true })).toBeVisible();
  }

  await page.getByRole("link", { name: "Liste", exact: true }).click();
  await expect(page).toHaveURL(/[?&]vis=liste/);
  await expect(page.getByRole("heading", { name: "Køen" })).toBeVisible();
});
