import { expect, test } from "@playwright/test";

/**
 * Røyktest av de mest kritiske offentlige flatene. Den krever en kjørende app
 * med database (CI setter opp Postgres og migrasjoner).
 */
test("readiness og innloggingsside", async ({ page, request }) => {
  const ready = await request.get("/api/ready");
  expect(ready.status()).toBe(200);
  await expect(ready).toBeOK();

  await page.goto("/logg-inn");
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
  await expect(page.getByLabel("E-postadresse")).toBeVisible();
  await expect(page.getByLabel("Passord")).toBeVisible();
  await expect(page.getByRole("button", { name: "Logg inn" })).toBeVisible();
});

test("ukjent side gir 404", async ({ page }) => {
  const response = await page.goto("/finnes-ikke");
  expect(response?.status()).toBe(404);
});
