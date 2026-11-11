import { expect, test } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Skjemavalidering skal si hva som er galt og hvilket felt det gjelder –
 * ikke bare «Feltene er ugyldige» eller en nettleserpopup.
 */
test("skjemafeil vises med feltnavn, oppsummering og fokus", async ({
  page,
}) => {
  test.skip(
    !roleCredentials("office"),
    "E2E_OFFICE_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "office")).toBe(true);

  await page.goto("/oppdrag/ny");

  const title = page.getByLabel("Oppdragstittel");
  await expect(title).toBeVisible({ timeout: 20_000 });
  await expect(title).toHaveValue("");

  await page.getByRole("button", { name: /Lagre oppdrag/i }).click();

  const summary = page.getByRole("alert").filter({
    hasText: /Skjemaet har \d+ feil/i,
  });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(/Oppdragstittel/i);
  await expect(summary).toContainText(/påkrevd/i);

  // Første feil skal ha fokus, og lenken i oppsummeringen skal peke dit.
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute("aria-invalid", "true");

  // Feilmeldingen skal også stå rett under feltet.
  await expect(
    page.locator('[id$="-error"]').filter({ hasText: /Oppdragstittel/i }).first(),
  ).toBeVisible();

  // Skjemaet skal ikke ha navigert bort.
  await expect(page).toHaveURL(/\/oppdrag\/ny/);
});
