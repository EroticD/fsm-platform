import { expect, test } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Read-only røyktest for kundebestillingen. Kunden velger dato – ikke
 * tidsblokk – og bestillingen er en ubekreftet forespørsel.
 */
test("kundeportalen viser sted, tjeneste og datofelt på mobil", async ({
  page,
}) => {
  const loggedIn = await loginAsRole(page, "customer");
  test.skip(!loggedIn, "E2E_CUSTOMER_EMAIL/PASSWORD er ikke satt");

  await page.goto("/kundeportal");

  await expect(
    page.getByRole("heading", { name: "Be om et besøk" }),
  ).toBeVisible();
  await expect(page.getByText("1. Velg sted")).toBeVisible();
  await expect(page.getByText("2. Velg tjeneste")).toBeVisible();
  await expect(page.getByText("3. Velg ønsket dato")).toBeVisible();
  await expect(page.locator('input[name="requestedDate"]')).toBeVisible();
  await expect(
    page.getByText(/Skriv ønsket klokkeslett/).first(),
  ).toBeVisible();

  await page.setViewportSize({ width: 375, height: 900 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("kundebestilling ender i kontorets bookingkø og kan avlyses", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !roleCredentials("customer") || !roleCredentials("office"),
    "E2E_CUSTOMER_/E2E_OFFICE_ mangler",
  );
  expect(await loginAsRole(page, "customer")).toBe(true);

  const marker = `E2E bestilling ${Date.now()}`;
  await page.goto("/kundeportal");

  // Den seedede kunden har ingen lagrede steder, så skjemaet starter på
  // «Nytt sted». Velg det eksplisitt i tilfelle en tidligere kjøring har lagt
  // igjen et sted, og fyll ut feltene kontoret trenger.
  await page.locator("#booking-site").selectOption("__new__").catch(() => undefined);
  await page.locator("#booking-new-site-name").fill(`E2E-sted ${marker}`);
  await page.locator("#booking-title").fill(marker);
  await page
    .locator("#booking-description")
    .fill("Automatisk E2E-forespørsel. Ønskes på formiddagen.");
  const dateInput = page.locator("#booking-requested-date");
  const earliestDate = await dateInput.getAttribute("min");
  await dateInput.fill(earliestDate ?? isoDateOffset(2));
  await page.locator("#booking-contact-phone").fill("22 00 00 99");

  const submit = page
    .locator("#booking-form")
    .getByRole("button", { name: /Bekreft bookingen|Confirm booking/ });
  await expect(submit).toBeEnabled();
  await submit.click();

  const success = page
    .getByRole("status")
    .filter({ hasText: /Forespørselen er sendt|Your request has been sent/ });
  await expect(success).toBeVisible({ timeout: 20_000 });
  await expect(success).toContainText(/Referanse|Reference/);

  const baseURL =
    test.info().project.use.baseURL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    "http://127.0.0.1:3000";
  const officeContext = await browser.newContext({ baseURL });
  const officePage = await officeContext.newPage();
  try {
    expect(await loginAsRole(officePage, "office")).toBe(true);
    await officePage.goto("/bookinger");

    const card = officePage
      .locator("article")
      .filter({ hasText: marker })
      .first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText(/Venter|Pending/).first()).toBeVisible();
    await expect(card).toContainText(/Referanse|Reference/);

    // Rydd opp: avlys den ubekreftede forespørselen fra køen, slik at
    // gjentatte lokale kjøringer ikke fyller køen.
    await card.getByRole("button", { name: /Avlys|Cancel/ }).click();
    await expect(card.getByText(/Avlyst|Cancelled/).first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await officeContext.close();
  }
});
