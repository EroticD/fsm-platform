import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  loginAsAdmin,
  loginAsRole,
  roleCredentials,
  type E2ERole,
} from "./helpers";

const DEFAULT_IMPACTS = ["critical", "serious", "moderate"];

/** Miljøvariablene gjør det mulig å stramme inn eller utvide matrisen lokalt. */
const BLOCKING_IMPACTS = new Set(
  (process.env.E2E_A11Y_IMPACTS ?? DEFAULT_IMPACTS.join(","))
    .split(",")
    .map((impact) => impact.trim())
    .filter(Boolean),
);

const A11Y_TAGS = (
  process.env.E2E_A11Y_TAGS ?? "wcag2a,wcag2aa,wcag21aa,wcag22aa"
)
  .split(",")
  .map((tag) => tag.trim())
  .filter(Boolean);

const MENU_ID = "app-navigation";

const OFFICE_ROUTES = [
  "/",
  "/oppdrag",
  "/kunder",
  "/dokumenter",
  "/rapporter",
  "/sok?q=service",
  "/varsler",
  "/innstillinger",
  "/kart",
  "/kalender",
  "/kalender/dispatch",
  "/kalender/kapasitet",
  "/kalender/maned",
  "/innstillinger?tab=dispatch",
  "/hms",
  "/brukere",
];

const ROLE_ROUTES: Record<E2ERole, string[]> = {
  admin: OFFICE_ROUTES,
  office: OFFICE_ROUTES,
  technician: ["/mine-oppdrag", "/mine-oppdrag/ny"],
  customer: ["/kundeportal"],
};

async function expectNoBlockingA11yIssues(page: Page, context?: string) {
  // Next dev kan sende en fast-refresh-reload rett etter første rendering.
  // Vent til nettverket er rolig, og prøv analysen én gang til hvis
  // kjøringskonteksten ble revet ned av en navigasjon.
  let results:
    | Awaited<ReturnType<InstanceType<typeof AxeBuilder>["analyze"]>>
    | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    try {
      results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(500);
    }
  }
  if (!results) throw new Error("Axe-analysen ga ingen resultat");
  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ""),
  );
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target),
    })),
    `${context ?? page.url()} har a11y-brudd på nivåene ${[
      ...BLOCKING_IMPACTS,
    ].join(", ")}`,
  ).toEqual([]);
}

type FocusInfo = {
  tag: string;
  label: string;
  focusVisible: boolean;
  visible: boolean;
  hasIndicator: boolean;
};

/**
 * Sjekker at elementet som har fokus faktisk viser en fokusmarkering.
 * Tailwind bruker ofte `focus:border-*` i stedet for outline, så vi leter også
 * i stilarkene etter en :focus-regel som treffer elementet.
 */
async function expectFocusVisible(page: Page, step: string): Promise<string> {
  const info = await page.evaluate((): FocusInfo | null => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const outlineWidth = Number.parseFloat(style.outlineWidth || "0");
    const outlineVisible =
      style.outlineStyle !== "none" && outlineWidth > 0;
    const shadowVisible =
      style.boxShadow !== "" && style.boxShadow !== "none";

    let ruleIndicator = false;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        // Stilark fra en annen origin kan ikke leses.
        continue;
      }

      const queue: CSSRule[] = Array.from(rules);
      while (queue.length > 0) {
        const rule = queue.pop() as CSSRule & {
          cssRules?: CSSRuleList;
          selectorText?: string;
          style?: CSSStyleDeclaration;
        };
        if (rule.cssRules) queue.push(...Array.from(rule.cssRules));

        const selector = rule.selectorText;
        const declarations = rule.style?.cssText ?? "";
        if (!selector || !selector.includes(":focus")) continue;
        if (
          !/(outline|box-shadow|border|background|filter|text-decoration)/i.test(
            declarations,
          )
        ) {
          continue;
        }

        for (const part of selector.split(",")) {
          const cleaned = part
            .replace(/:focus-visible/g, "")
            .replace(/:focus\b/g, "")
            .trim();
          if (!cleaned) {
            ruleIndicator = true;
            break;
          }
          try {
            if (element.matches(cleaned)) {
              ruleIndicator = true;
              break;
            }
          } catch {
            // Ugyldig eller for kompleks selector – prøv neste.
          }
        }
        if (ruleIndicator) break;
      }
      if (ruleIndicator) break;
    }

    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("name") ||
      element.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) ||
      element.tagName.toLowerCase();

    return {
      tag: element.tagName.toLowerCase(),
      label,
      focusVisible: element.matches(":focus-visible"),
      visible: rect.width > 0 && rect.height > 0,
      hasIndicator: outlineVisible || shadowVisible || ruleIndicator,
    };
  });

  expect(info, `${step}: ingen element har fokus`).not.toBeNull();
  expect(info?.focusVisible, `${step}: :focus-visible mangler`).toBe(true);
  expect(info?.visible, `${step}: fokuselementet er skjult`).toBe(true);
  expect(
    info?.hasIndicator,
    `${step}: mangler synlig fokusmarkering`,
  ).toBe(true);

  return `${info?.tag}:${info?.label}`;
}

async function firstHref(
  page: Page,
  selector: string,
  timeout = 10_000,
): Promise<string | null> {
  // Lister har ofte både en mobil og en desktop-variant av samme lenke. Velg
  // den som faktisk er synlig i gjeldende viewport.
  const link = page.locator(selector).filter({ visible: true }).first();
  // Sider som streames viser skjelettet først; vent på at lenken faktisk blir
  // synlig før vi konkluderer med at databasen er tom.
  const found = await link
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!found) return null;
  return link.getAttribute("href").catch(() => null);
}

async function findReportFormHref(page: Page): Promise<string | null> {
  const directPath = process.env.E2E_REPORT_PATH;
  if (directPath) return directPath;

  await page.goto("/mine-oppdrag");
  const workOrderLinks = page
    .locator('a[href^="/mine-oppdrag/"]:not([href="/mine-oppdrag/ny"])')
    .filter({ visible: true });
  if ((await workOrderLinks.count()) === 0) return null;

  const hrefs = [
    ...new Set(
      (await workOrderLinks.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")),
      )).filter((href): href is string => Boolean(href)),
    ),
  ].slice(0, 6);

  // Det første oppdraget kan mangle sjekkliste. Prøv noen få til, men hold
  // kjøretiden nede i en database uten rapporter.
  for (const href of hrefs) {
    await page.goto(href);
    const formHref = await firstHref(page, 'a[href*="/skjema/"]', 2_000);
    if (formHref) return formHref;
  }
  return null;
}

test("innloggingssiden har ingen blokkerende a11y-brudd", async ({ page }) => {
  await page.goto("/logg-inn");
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
  await expectNoBlockingA11yIssues(page, "innlogging");
});

// Admin og kontor deler de samme arbeidsflatene. Tekniker og kunde får egne
// lister, og hoppes over når testkontoene ikke er satt lokalt.
for (const role of Object.keys(ROLE_ROUTES) as E2ERole[]) {
  test(`${role}: arbeidsflatene har ingen blokkerende a11y-brudd`, async ({
    page,
  }) => {
    // Matrisen besøker mange ruter; hver axe-kjøring venter på nettverksro.
    test.setTimeout(90_000);
    test.skip(
      !roleCredentials(role),
      `Mangler testkonto for ${role} (${role.toUpperCase()}_EMAIL/PASSWORD)`,
    );
    expect(await loginAsRole(page, role)).toBe(true);

    for (const path of ROLE_ROUTES[role]) {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      await expectNoBlockingA11yIssues(page, `${role} ${path}`);
    }
  });
}

test("admin: oppdrags- og kundedetaljer med data fra databasen", async ({
  page,
}) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  expect(await loginAsAdmin(page)).toBe(true);

  await page.goto("/oppdrag");
  const orderHref = await firstHref(
    page,
    'a[href^="/oppdrag/"]:not([href="/oppdrag/ny"]):not([href^="/oppdrag/ny/"])',
  );
  if (!orderHref) {
    test.skip(true, "Fant ingen oppdrag i databasen");
    return;
  }
  await page.goto(orderHref);
  await expect(page.locator("main")).toBeVisible();
  await expectNoBlockingA11yIssues(page, `oppdragsdetalj ${orderHref}`);

  await page.goto("/kunder");
  const customerHref = await firstHref(
    page,
    'a[href^="/kunder/"]:not([href$="/rediger"])',
  );
  if (!customerHref) {
    test.skip(true, "Fant ingen kunde i databasen");
    return;
  }
  await page.goto(customerHref);
  await expect(page.locator("main")).toBeVisible();
  await expectNoBlockingA11yIssues(page, `kundedetalj ${customerHref}`);
});

test("tekniker: oppdragsdetalen har ingen blokkerende a11y-brudd", async ({
  page,
}) => {
  test.skip(
    !roleCredentials("technician"),
    "E2E_TECHNICIAN_EMAIL/PASSWORD er ikke satt",
  );
  expect(await loginAsRole(page, "technician")).toBe(true);

  await page.goto("/mine-oppdrag");
  const workOrderHref = await firstHref(
    page,
    'a[href^="/mine-oppdrag/"]:not([href="/mine-oppdrag"]):not([href="/mine-oppdrag/ny"]):not([href*="/skjema/"])',
  );
  if (!workOrderHref) {
    test.skip(true, "Fant ingen oppdrag for teknikeren");
    return;
  }

  await page.goto(workOrderHref);
  await expect(page.locator("main")).toBeVisible();
  await expectNoBlockingA11yIssues(page, `teknikeroppdrag ${workOrderHref}`);
});

test("skjemaer for oppretting og redigering er tilgjengelige", async ({ page }) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  for (const path of ["/oppdrag/ny", "/mine-oppdrag/ny"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectNoBlockingA11yIssues(page, path);
  }

  // Redigeringssiden for et eksisterende oppdrag. Uten oppdrag i databasen
  // hopper vi over, slik at testen er stabil i en tom testdatabase.
  await page.goto("/oppdrag");
  const href = await firstHref(
    page,
    'a[href^="/oppdrag/"]:not([href="/oppdrag/ny"]):not([href^="/oppdrag/ny/"])',
  );
  if (!href) {
    test.skip(true, "Fant ingen oppdrag å redigere");
    return;
  }
  await page.goto(`${href}/rediger`);
  await expect(page.locator("main")).toBeVisible();
  await expectNoBlockingA11yIssues(page, `${href}/rediger`);
});

test("innstillinger for ansatte og maler er tilgjengelige", async ({ page }) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  for (const path of [
    "/innstillinger?tab=ansatte",
    "/innstillinger?tab=maler",
    "/innstillinger?tab=roller",
  ]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectNoBlockingA11yIssues(page, path);
  }
});

test("rapportskjemaet er tilgjengelig og kan brukes med tastatur", async ({
  page,
}) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  const formHref = await findReportFormHref(page);
  if (!formHref) {
    test.skip(true, "Fant ikke noe oppdrag med rapportskjema");
    return;
  }

  await page.goto(formHref);
  await expect(page.locator("main")).toBeVisible();
  await expectNoBlockingA11yIssues(page, `rapportskjema ${formHref}`);

  // Tab inn i skjemaet med tastaturet og krev at hvert fokuserte element har
  // en synlig fokusmarkering.
  let reachedForm = false;
  for (let step = 1; step <= 40; step += 1) {
    await page.keyboard.press("Tab");
    await expectFocusVisible(page, `rapportskjema inn ${step}`);
    if (
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest("main form")),
      )
    ) {
      reachedForm = true;
      break;
    }
  }
  expect(reachedForm, "Tab skal nå rapportskjemaet").toBe(true);

  const visited = new Set<string>();
  for (let step = 1; step <= 10; step += 1) {
    await page.keyboard.press("Tab");
    visited.add(await expectFocusVisible(page, `rapportskjema tab ${step}`));
  }
  expect(visited.size, "Tab skal flytte fokus gjennom flere kontroller").toBeGreaterThan(1);
});

test("bekreftelsesdialog er tilgjengelig og lukkes med Escape", async ({
  page,
}) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  expect(await loginAsAdmin(page)).toBe(true);

  // Malene seedes av migrasjonene, så denne dialogen finnes også i en tom
  // testdatabase. Vi bekrefter aldri slettingen – Escape avbryter.
  await page.goto("/innstillinger?tab=maler");
  const deleteButton = page
    .getByRole("button", { name: "Slett", exact: true })
    .first();
  const hasDeleteAction = await deleteButton
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasDeleteAction) {
    test.skip(true, "Fant ingen mal å åpne bekreftelsesdialog for");
    return;
  }

  await deleteButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Bekreft handling" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Avbryt" })).toBeFocused();
  await expectNoBlockingA11yIssues(page, "bekreftelsesdialog");

  await page.keyboard.press("Tab");
  await expectFocusVisible(page, "bekreftelsesdialog tab");
  expect(
    await page.evaluate(() =>
      Boolean(
        document
          .querySelector('[role="dialog"]')
          ?.contains(document.activeElement),
      ),
    ),
    "Tab skal holde fokus inne i dialogen",
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
});

test("mobil meny er en merket dialog med tastaturstyrt fokusfelle", async ({
  page,
}) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  await page.setViewportSize({ width: 375, height: 812 });
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);
  await page.goto("/");

  const menuButton = page.locator(`button[aria-controls="${MENU_ID}"]`);
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");

  // Start på «Hopp til innhold» og tab gjennom headeren, slik at
  // :focus-visible faktisk gjelder når vi kommer til meny knappen.
  await page.locator('a[href="#main-content"]').first().focus();
  let reachedMenuButton = false;
  for (let step = 1; step <= 20; step += 1) {
    await page.keyboard.press("Tab");
    if (
      await menuButton.evaluate((element) => document.activeElement === element)
    ) {
      reachedMenuButton = true;
      await expectFocusVisible(page, `mobil meny knapp (tab ${step})`);
      break;
    }
  }
  expect(reachedMenuButton, "Tab skal nå meny knappen").toBe(true);

  // Åpne med tastatur, ikke mus.
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /meny/i });
  await expect(dialog).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(menuButton).toHaveAttribute("aria-controls", MENU_ID);
  await expectNoBlockingA11yIssues(page, "mobil meny");

  // Tab noen steg og krev at fokus både er synlig og blir værende i dialogen.
  for (let step = 1; step <= 6; step += 1) {
    await page.keyboard.press("Tab");
    await expectFocusVisible(page, `mobil meny tab ${step}`);
    expect(
      await page.evaluate((id) => {
        const menu = document.getElementById(id);
        return Boolean(menu?.contains(document.activeElement));
      }, MENU_ID),
      `Tab ${step} skal holde fokus inne i menyen`,
    ).toBe(true);
  }

  // Escape lukker menyen og setter fokus tilbake på åpneknappen.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();
});

test("toastvarselet er tilgjengelig", async ({ page }) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  expect(await loginAsAdmin(page)).toBe(true);

  // Statusparameteren viser en ekte toast uten å endre data.
  await page.goto("/kunder?status=kunde-oppdatert");
  const toast = page
    .getByRole("status")
    .filter({ hasText: /Kundeinformasjonen er lagret|The customer information was saved/ });
  await expect(toast).toBeVisible();
  await toast.hover(); // Pauser autolukkingen mens axe skanner.
  await expectNoBlockingA11yIssues(page, "toast");
});

test("mobil visning av innlogging har ikke horisontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/logg-inn");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("oppdrags- og kundelister har ikke horisontal scroll på mobil", async ({ page }) => {
  test.skip(!roleCredentials("admin"), "E2E_ADMIN_EMAIL/PASSWORD er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/oppdrag", "/kunder"]) {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} har horisontal scroll`).toBeLessThanOrEqual(1);
  }
});
