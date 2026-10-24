import { expect, type Page } from "@playwright/test";

/**
 * Logger inn med en testkonto. Krever E2E_ADMIN_EMAIL og E2E_ADMIN_PASSWORD;
 * uten dem hopper autentiserte tester over innloggingen.
 */
export async function loginAsAdmin(page: Page): Promise<boolean> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) return false;

  await page.goto("/logg-inn");
  await page.getByLabel("E-post", { exact: true }).fill(email);
  await page.getByLabel("Passord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"), {
    timeout: 15_000,
  });

  const response = await page.request.get("/api/auth/session");
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  expect(session?.user?.email).toBe(email);
  return true;
}
