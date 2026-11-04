import { expect, test } from "@playwright/test";
import { loginAsRole } from "./helpers";

// Chromium får et syntetisk kamerabilde. Flagsene må ligge på toppnivå fordi
// de krever en egen nettleserprosess. Testen dekker åpning, synlig video og at
// sporingen stoppes – ikke faktisk QR-dekoding av et fysisk kamera.
test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

/**
 * Regresjonstest for headeren som blokkerte kameraet. Uten `camera=(self)`
 * feiler getUserMedia før nettleseren i det hele tatt spør brukeren.
 */
test("Permissions-Policy tillater kamera for eget opphav", async ({
  request,
}) => {
  // /skann er ruten som faktisk bruker kameraet. Uten innlogging svarer den
  // med en omdirigering, men headeren skal ligge på svaret uansett.
  const response = await request.get("/skann", { maxRedirects: 0 });
  const policy = response.headers()["permissions-policy"] ?? "";
  expect(policy).toContain("camera=(self)");
  expect(policy).not.toContain("camera=()");
  expect(policy).not.toContain("camera=*");
  expect(policy).toContain("microphone=()");
  expect(policy).toContain("geolocation=(self)");
});

test.describe("kameraåpning", () => {
  test("åpner kameraet på /skann og slipper sporingen", async ({ page }) => {
    const loggedIn = await loginAsRole(page, "technician");
    test.skip(
      !loggedIn,
      "E2E_TECHNICIAN_EMAIL/PASSWORD er ikke satt",
    );

    await page.goto("/skann");
    await page.getByRole("button", { name: "Start kamera" }).click();

    const video = page.locator("video");
    await expect(video).toBeVisible();

    const liveBefore = await video.evaluate((element) => {
      const stream = (element as HTMLVideoElement).srcObject as MediaStream | null;
      return (
        stream
          ?.getTracks()
          .filter((track) => track.readyState === "live").length ?? 0
      );
    });
    expect(liveBefore).toBeGreaterThan(0);

    // Verken «ikke støttet» eller «nektet» skal vises når kameraet faktisk
    // åpner seg. ZXing-reserven dekker nettlesere uten BarcodeDetector.
    await expect(
      page.locator('[data-scanner-state="unsupported"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-scanner-state="denied"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Stopp kamera" }).click();
    await expect(video).toBeHidden();

    const liveAfter = await video.evaluate((element) => {
      const stream = (element as HTMLVideoElement).srcObject as MediaStream | null;
      return (
        stream
          ?.getTracks()
          .filter((track) => track.readyState === "live").length ?? 0
      );
    });
    expect(liveAfter).toBe(0);
  });

  test("bruker ZXing-reserven når BarcodeDetector mangler", async ({ page }) => {
    const loggedIn = await loginAsRole(page, "technician");
    test.skip(
      !loggedIn,
      "E2E_TECHNICIAN_EMAIL/PASSWORD er ikke satt",
    );

    // Simulerer iOS Safari og Android-nettlesere uten BarcodeDetector.
    await page.addInitScript(() => {
      Object.defineProperty(window, "BarcodeDetector", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/skann");
    await page.getByRole("button", { name: "Start kamera" }).click();

    await expect(
      page.getByText("Holder kameraet mot QR-koden …"),
    ).toBeVisible();
    await expect(page.locator("video")).toBeVisible();
    await expect(
      page.locator('[data-scanner-state="unsupported"]'),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Stopp kamera" }).click();
  });
});
