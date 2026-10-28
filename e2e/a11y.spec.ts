import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAsAdmin } from "./helpers";

const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

async function expectNoBlockingA11yIssues(page: Parameters<typeof loginAsAdmin>[0]) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
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
  ).toEqual([]);
}

test("innloggingssiden har ingen kritiske a11y-brudd", async ({ page }) => {
  await page.goto("/logg-inn");
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
  await expectNoBlockingA11yIssues(page);
});

test("hovedflatene har ingen kritiske a11y-brudd", async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
  const loggedIn = await loginAsAdmin(page);
  expect(loggedIn).toBe(true);

  for (const path of ["/", "/kunder", "/dokumenter", "/innstillinger", "/varsler", "/kart"]) {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    await expectNoBlockingA11yIssues(page);
  }
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
  test.skip(!process.env.E2E_ADMIN_EMAIL, "E2E_ADMIN_EMAIL er ikke satt");
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
