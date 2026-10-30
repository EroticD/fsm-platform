import { expect, test } from "@playwright/test";
import { loginAsRole } from "./helpers";

/**
 * Read-only røyktest for den nye slotvelgeren. Den muterer ingen data, slik at
 * den kan kjøres mot den vanlige E2E-basen uten opprydding.
 */
test("kundeportalen viser sted, tjeneste og ekte slotvelger på mobil", async ({
  page,
}) => {
  const loggedIn = await loginAsRole(page, "customer");
  test.skip(!loggedIn, "E2E_CUSTOMER_EMAIL/PASSWORD er ikke satt");

  await page.goto("/kundeportal");

  await expect(
    page.getByRole("heading", { name: "Book en ledig time" }),
  ).toBeVisible();
  await expect(page.getByText("1. Velg sted")).toBeVisible();
  await expect(page.getByText("2. Velg tjeneste")).toBeVisible();
  await expect(page.getByText("3. Velg ledig time")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Neste uke" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 375, height: 900 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
