import { expect, type Page } from "@playwright/test";

export type E2ERole = "admin" | "office" | "technician" | "customer";

const ROLE_ENV_PREFIX: Record<E2ERole, string> = {
  admin: "E2E_ADMIN",
  office: "E2E_OFFICE",
  technician: "E2E_TECHNICIAN",
  customer: "E2E_CUSTOMER",
};

export type E2ECredentials = {
  email: string;
  password: string;
};

/**
 * Henter testkontoopplysningene for en rolle. Begge variablene må være satt;
 * ellers returneres null og testene for rollen hoppes over.
 */
export function roleCredentials(role: E2ERole): E2ECredentials | null {
  const prefix = ROLE_ENV_PREFIX[role];
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) return null;
  return { email, password };
}

async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
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
}

/**
 * Logger inn med testkontoen for rollen. Returnerer false når miljøvariablene
 * mangler, slik at testen kan hoppe over uten hemmeligheter lokalt.
 */
export async function loginAsRole(
  page: Page,
  role: E2ERole,
): Promise<boolean> {
  const credentials = roleCredentials(role);
  if (!credentials) return false;

  await login(page, credentials.email, credentials.password);
  return true;
}

/**
 * Logger inn med en testkonto. Krever E2E_ADMIN_EMAIL og E2E_ADMIN_PASSWORD;
 * uten dem hopper autentiserte tester over innloggingen.
 */
export async function loginAsAdmin(page: Page): Promise<boolean> {
  return loginAsRole(page, "admin");
}
