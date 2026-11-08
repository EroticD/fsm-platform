import { expect, test, type Page } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Visuell QA for kalenderen (UX-08):
 *   - to-ukersvisningen skal vise riktig dato i begge ukeradene og riktig
 *     ISO-ukenummer per rad,
 *   - timegrid skal åpne på 07:00 i en faktisk rullbar beholder,
 *   - svært korte hendelser skal beholde tittel og klokkeslett, men skjule
 *     adresse og statuslinje.
 *
 * Testene hopper over når E2E-kontoen mangler, på samme måte som qa-flows.
 */

const WEEK_ONE = "2026-11-09";
const WEEK_TWO = "2026-11-16";
const WEEK_ONE_NUMBER = "46";
const WEEK_TWO_NUMBER = "47";

async function weekNumbersOnPage(page: Page): Promise<string[]> {
  const values = await page
    .locator("[data-week-number]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-week-number") ?? ""),
    );
  return [...new Set(values.filter(Boolean))].sort();
}

test("kalender: to-ukersvisning viser datoer og riktige ukenumre", async ({
  page,
}) => {
  test.skip(
    !roleCredentials("office"),
    "E2E_OFFICE_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "office")).toBe(true);

  await page.goto(`/kalender?vis=2uker&dato=${WEEK_ONE}`);

  const firstMonday = page
    .locator(`.kal-day-cell[data-date="${WEEK_ONE}"]`)
    .first();
  const secondMonday = page
    .locator(`.kal-day-cell[data-date="${WEEK_TWO}"]`)
    .first();
  await expect(firstMonday).toBeVisible({ timeout: 20_000 });
  await expect(secondMonday).toBeVisible();

  // Begge radene skal ha en kompakt dato. På smale skjermer er den bare
  // dagnummeret, på bredere skjermer dag/måned.
  await expect(firstMonday.locator(".kal-biweekly-date")).toHaveText(
    /^9(\/11)?$/,
  );
  await expect(secondMonday.locator(".kal-biweekly-date")).toHaveText(
    /^16(\/11)?$/,
  );

  // Kolonneoverskriften skal bare vise ukedag. Den kunstige 1970-datoen skal
  // ikke lenger lekke ut som dagnummer i overskriften.
  const headerLabels = page.locator(".kal-day-header-label");
  await expect(headerLabels).toHaveCount(7);
  for (const text of await headerLabels.allTextContents()) {
    expect(text).not.toMatch(/\d/);
  }

  // Uke 46 starter 9. november og uke 47 starter 16. november (ISO-uker).
  await expect
    .poll(() => weekNumbersOnPage(page), { timeout: 20_000 })
    .toEqual([WEEK_ONE_NUMBER, WEEK_TWO_NUMBER]);
});

test("kalender: timegrid åpner på 07:00 i en rullbar beholder", async ({
  page,
}) => {
  test.skip(
    !roleCredentials("office"),
    "E2E_OFFICE_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "office")).toBe(true);

  await page.goto(`/kalender?vis=timegrid&dato=${WEEK_ONE}`);

  const scroller = page.getByTestId("calendar-scroller").first();
  await expect(scroller).toBeVisible({ timeout: 20_000 });

  // scrollTime 07:00 settes etter at høyden er målt. Vent til posisjonen er
  // anvendt i stedet for å anta at den er klar ved første rendering.
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  const position = await scroller.evaluate((element) => {
    const inScroller = Array.from(
      element.querySelectorAll<HTMLElement>(".kal-slot-header-inner"),
    );
    const labels = inScroller.length
      ? inScroller
      : Array.from(
          document.querySelectorAll<HTMLElement>(".kal-slot-header-inner"),
        );
    const seven = labels.find((label) =>
      /^0?7(:00)?$/.test((label.textContent ?? "").trim()),
    );
    return {
      scrollTop: element.scrollTop,
      sevenOffset: seven
        ? Math.round(
            seven.getBoundingClientRect().top -
              element.getBoundingClientRect().top,
          )
        : null,
    };
  });

  expect(position.scrollTop).toBeGreaterThan(0);
  expect(position.sevenOffset).not.toBeNull();
  // 07:00 skal stå øverst i den synlige delen av tidsrutenettet, eller like
  // under kanten når nettleseren har avrundet scrollposisjonen.
  expect(position.sevenOffset!).toBeGreaterThan(-4);
  expect(position.sevenOffset!).toBeLessThan(36);
});

test("kalender: korte hendelser skjuler adresse og beholder tittel", async ({
  page,
}) => {
  test.skip(
    !roleCredentials("office"),
    "E2E_OFFICE_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "office")).toBe(true);

  await page.goto("/kalender?vis=timegrid");

  // Seed kan mangle korte hendelser. Vent først på at kalenderen har rendret
  // hendelser, og hopp deretter tydelig hvis ingen er under 30 minutter.
  await page
    .locator('[data-testid="calendar-event"]')
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => undefined);

  const shortEvents = page.locator(
    '[data-testid="calendar-event"][data-short="true"]',
  );
  if ((await shortEvents.count()) === 0) {
    test.skip(
      true,
      "Ingen seedet tidsstyrt hendelse under 30 minutter i denne uken",
    );
  }

  const event = shortEvents.first();
  await expect(event).toBeVisible();
  const title = event.locator(".fc-event-title-line");
  await expect(title).toBeVisible();
  await expect(title).toHaveText(/\S/);
  await expect(event.locator(".fc-event-address")).toBeHidden();
});
