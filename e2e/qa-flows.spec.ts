import { expect, test, type Page } from "@playwright/test";
import { loginAsRole, roleCredentials } from "./helpers";

/**
 * Skriveflytene som QA-01 krever dekning for:
 *   - dispatch: dra en ufordelt visitt til en montørkolonne,
 *   - kalender: flytt en visitt med dra-og-slipp og få konfliktvarsel når
 *     oppdraget har bevaringsplikt,
 *   - offline: skriv en rapportkladd uten nett og la outboxen replaye den.
 *
 * Testene muterer bare egne seedede rader og rydder opp i `finally`.
 */

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function eventDate(page: Page, title: string): Promise<string> {
  return (
    (await page
      .locator(".fc-event")
      .filter({ hasText: title })
      .first()
      .evaluate((element) =>
        element.closest("[data-date]")?.getAttribute("data-date"),
      )) ?? ""
  );
}

/** Nærmeste nabodag som faktisk er rendret i gjeldende kalenderperiode. */
async function adjacentVisibleDate(
  page: Page,
  sourceDate: string,
): Promise<string> {
  const dates = [
    ...new Set(
      (await page.locator("td.fc-day[data-date]").evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute("data-date")),
      )).filter((date): date is string => Boolean(date)),
    ),
  ].sort();
  const index = dates.indexOf(sourceDate);
  const target = dates[index + 1] ?? dates[index - 1];
  if (!target) throw new Error(`Fant ingen nabodag til ${sourceDate}`);
  return target;
}

async function holdForm(page: Page) {
  const input = page.locator('form input[name="hold"]').first();
  await expect(input).toHaveAttribute("value", /^(true|false)$/, {
    timeout: 20_000,
  });
  return {
    input,
    form: input.locator("xpath=ancestor::form[1]"),
  };
}

async function releaseLegalHold(page: Page): Promise<void> {
  const { input, form } = await holdForm(page);
  // value=true betyr at skjemaet slår bevaringsplikten PÅ, altså er den av.
  if ((await input.getAttribute("value")) !== "false") return;

  await page
    .getByLabel("Årsak til å oppheve bevaringsplikten")
    .fill("E2E rydder opp etter konflikttesten.");
  await form.getByRole("button").click();
  await expect(input).toHaveAttribute("value", "true", { timeout: 20_000 });
}

async function dragToDate(page: Page, title: string, date: string) {
  const event = page.locator(".fc-event").filter({ hasText: title }).first();
  await expect(event).toBeVisible({ timeout: 20_000 });
  // Ukevisningen har både en TH-header og en TD-dagcelle med samme dato.
  // Slippet må treffe dagcellen, ellers starter FullCalendar ingen flytting.
  const target = page.locator(`td.fc-day[data-date="${date}"]`).first();
  await expect(target).toBeVisible();

  // Kalenderen er høyere enn standard testviewport. Sørg for at både kortet
  // og dagcellen faktisk ligger innenfor vinduet før musepekeren flyttes.
  await target.scrollIntoViewIfNeeded();
  const source = await event.boundingBox();
  const destination = await target.boundingBox();
  if (!source || !destination) {
    throw new Error(`Fant ikke dragmål for ${title} → ${date}`);
  }

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  // FullCalendar krever noen bevegelser før draget regnes som startet.
  await page.mouse.move(
    source.x + source.width / 2 + 8,
    source.y + source.height / 2 + 8,
    { steps: 5 },
  );
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
}

function visitPatch(page: Page) {
  return page.waitForResponse(
    (response) =>
      /\/api\/visits\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PATCH",
    { timeout: 20_000 },
  );
}

async function outboxCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("fsm-offline", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("outbox", "readonly");
          const all = transaction.objectStore("outbox").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => resolve(all.result.length);
          transaction.oncomplete = () => db.close();
        };
      }),
  );
}

async function findReportFormHref(page: Page): Promise<string | null> {
  await page.goto("/mine-oppdrag");

  // Oppdragslista har ofte en direkte «Fortsett skjema»-lenke. Bruk den først;
  // den er både raskere og mindre følsom for tung detaljrendering.
  const direct = page
    .locator('a[href*="/skjema/"]')
    .filter({ visible: true })
    .first();
  if (
    await direct
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    return direct.getAttribute("href");
  }

  const links = page
    .locator('a[href^="/mine-oppdrag/"]')
    .filter({ visible: true });
  const hrefs = [
    ...new Set(
      (await links.evaluateAll((items) =>
        items.map((item) => item.getAttribute("href")),
      )).filter(
        (href): href is string =>
          Boolean(href) && /^\/mine-oppdrag\/[a-z0-9]+$/.test(href ?? ""),
      ),
    ),
  ].slice(0, 6);

  for (const href of hrefs) {
    await page.goto(href);
    const form = page
      .locator('a[href*="/skjema/"]')
      .filter({ visible: true })
      .first();
    const found = await form
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (found) {
      return form.getAttribute("href");
    }
  }
  return null;
}

test("dispatch: dra en visitt mellom montørkolonner", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !roleCredentials("office"),
    "E2E_OFFICE_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "office")).toBe(true);

  // Seedens «Venter på deler – portmotor» ligger frem i tid og er tildelt
  // Demo Montør. Flytt den til en annen ansattkolonne og tilbake.
  await page.goto(
    `/kalender/dispatch?fra=${isoDateOffset(0)}&til=${isoDateOffset(10)}`,
  );

  const title = "Venter på deler – portmotor";
  const card = page
    .locator("[data-dispatch-visit]")
    .filter({ hasText: title })
    .first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  // Kolonnene gjentas per dag. Hold oss til dagen kortet faktisk står på.
  const daySection = card.locator("xpath=ancestor::section[1]");
  const technicianLane = daySection
    .locator('[data-dispatch-lane]:not([data-dispatch-lane="unassigned"])')
    .filter({ hasText: "Demo Montør" })
    .first();
  const adminLane = daySection
    .locator('[data-dispatch-lane]:not([data-dispatch-lane="unassigned"])')
    .filter({ hasText: "Demo Administrator" })
    .first();
  await expect(technicianLane).toBeVisible();
  await expect(adminLane).toBeVisible();

  await card.dragTo(adminLane);

  const movedCard = adminLane
    .locator("[data-dispatch-visit]")
    .filter({ hasText: title })
    .first();
  await expect(movedCard).toBeVisible({ timeout: 20_000 });

  // Rydd opp: dra kortet tilbake til den seedede montøren.
  await movedCard.dragTo(
    daySection
      .locator('[data-dispatch-lane]:not([data-dispatch-lane="unassigned"])')
      .filter({ hasText: "Demo Montør" })
      .first(),
  );
  await expect(
    daySection
      .locator('[data-dispatch-lane]:not([data-dispatch-lane="unassigned"])')
      .filter({ hasText: "Demo Montør" })
      .first()
      .locator("[data-dispatch-visit]")
      .filter({ hasText: title })
      .first(),
  ).toBeVisible({ timeout: 20_000 });
});

test("kalender: flytt en visitt med dra-og-slipp og flytt den tilbake", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !roleCredentials("office"),
    "E2E_OFFICE_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "office")).toBe(true);

  const today = isoDateOffset(0);
  await page.goto(`/kalender?vis=2uker&dato=${today}`);

  const title = "Venter på deler – portmotor";
  const event = page.locator(".fc-event").filter({ hasText: title }).first();
  await expect(event).toBeVisible({ timeout: 20_000 });
  const sourceDate = await eventDate(page, title);
  expect(sourceDate).not.toBe("");
  const targetDate = await adjacentVisibleDate(page, sourceDate);

  const firstPatch = visitPatch(page);
  await dragToDate(page, title, targetDate);
  expect((await firstPatch).status()).toBe(200);
  await expect
    .poll(() => eventDate(page, title), { timeout: 20_000 })
    .toBe(targetDate);

  const secondPatch = visitPatch(page);
  await dragToDate(page, title, sourceDate);
  expect((await secondPatch).status()).toBe(200);
  await expect
    .poll(() => eventDate(page, title), { timeout: 20_000 })
    .toBe(sourceDate);
});

test("kalender: konfliktvarsel når oppdraget har bevaringsplikt", async ({
  page,
}) => {
  test.setTimeout(120_000);
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  expect(await loginAsRole(page, "admin")).toBe(true);

  await page.goto("/oppdrag");
  const orderHref = await page
    .getByRole("link", { name: "Kvartalsservice – pumpe", exact: false })
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  expect(orderHref).toBeTruthy();
  const orderUrl = new URL(orderHref!, page.url()).toString();
  await page.goto(orderUrl);

  // En tidligere kjøring kan ha etterlatt bevaringsplikt. Rydd først.
  await releaseLegalHold(page);
  const { input, form } = await holdForm(page);
  await expect(input).toHaveAttribute("value", "true");
  await form.getByRole("button").click();
  await expect(input).toHaveAttribute("value", "false", { timeout: 20_000 });

  try {
    await page.goto(`/kalender?vis=2uker&dato=${isoDateOffset(0)}`);

    const title = "Kvartalsservice – pumpe";
    const event = page.locator(".fc-event").filter({ hasText: title }).first();
    await expect(event).toBeVisible({ timeout: 20_000 });
    const holdDate = await eventDate(page, title);
    expect(holdDate).not.toBe("");
    const nextDate = await adjacentVisibleDate(page, holdDate);

    const patch = visitPatch(page);
    await dragToDate(page, title, nextDate);
    expect((await patch).status()).toBe(409);

    const toast = page
      .getByRole("alert")
      .filter({ hasText: /bevaringsplikt|legal hold/i });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // FullCalendar skal ha rullet hendelsen tilbake til opprinnelig dag.
    await expect
      .poll(() => eventDate(page, title), { timeout: 20_000 })
      .toBe(holdDate);
  } finally {
    await page.goto(orderUrl);
    await releaseLegalHold(page);
  }
});

test("offline: kladd havner i outboxen og replayes når nettet kommer tilbake", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  test.skip(
    !roleCredentials("technician"),
    "E2E_TECHNICIAN_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "technician")).toBe(true);

  const formHref = await findReportFormHref(page);
  if (!formHref) {
    test.skip(true, "Fant ingen rapportskjema for teknikeren");
    return;
  }
  await page.goto(formHref);
  await expect(page.locator('textarea[name="notes"]')).toBeVisible({
    timeout: 20_000,
  });

  await context.setOffline(true);

  // SEC-01: offline-kladder krever en PIN. Første gang vises oppsettpanelet
  // når nettleseren går offline; sett PIN før kladden skrives.
  const pinSection = page.locator(
    'section[aria-label="Sett PIN for offline-kladder"]',
  );
  if (await pinSection.isVisible().catch(() => false)) {
    const setupButton = pinSection.getByRole("button", { name: "Sett PIN" });
    if (await setupButton.isVisible().catch(() => false)) {
      await setupButton.click();
    }
    await pinSection.getByLabel("PIN", { exact: true }).fill("123456");
    await pinSection.getByLabel("Gjenta PIN").fill("123456");
    await pinSection.getByRole("button", { name: "Sett PIN" }).click();
    await expect(pinSection).toBeHidden({ timeout: 10_000 });
  }

  await page
    .locator('textarea[name="notes"]')
    .fill(`E2E offline kladd ${Date.now()}`);

  // Lokal skriving skjer etter 200 ms, serverlagringen etter 1200 ms. Uten
  // nett skal sistnevnte feile og legge skjemaet i outboxen.
  await expect
    .poll(() => outboxCount(page), { timeout: 20_000 })
    .toBeGreaterThan(0);

  const offlineBanner = page
    .getByRole("status")
    .filter({ hasText: /Offline|kladd/ })
    .first();
  await expect(offlineBanner).toBeVisible({ timeout: 10_000 });

  const replay = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/offline/draft" &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await context.setOffline(false);
  // Nettleseren fyrer normalt «online» selv; knappen er en sikker fallback.
  await offlineBanner
    .getByRole("button", { name: /Send nå|Retry now/ })
    .click({ timeout: 3_000 })
    .catch(() => undefined);

  expect((await replay).status()).toBe(200);
  await expect.poll(() => outboxCount(page), { timeout: 20_000 }).toBe(0);
});
