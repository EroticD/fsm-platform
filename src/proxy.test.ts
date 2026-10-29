import { describe, expect, it } from "vitest";
import { config } from "./proxy";

/**
 * Next bruker matcher-strengen som en path-regex. Vi tester den samme
 * strengen direkte, slik at en fremtidig utvidelsesbasert utelatelse blir
 * fanget uten å bygge appen.
 */
const matches = (pathname: string) =>
  new RegExp(`^${config.matcher[0]}$`).test(pathname);

describe("CSP-matcher", () => {
  it("kjører på HTML-ruter som slutter på .js eller .png", () => {
    expect(matches("/oppdrag/foo.js")).toBe(true);
    expect(matches("/oppdrag/foo.png")).toBe(true);
    expect(matches("/kunder/123")).toBe(true);
    expect(matches("/offline.html")).toBe(true);
  });

  it("hoppet over kjente statiske Next-filer", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/_next/image")).toBe(false);
    expect(matches("/_next/webpack-hmr")).toBe(false);
  });

  it("hoppet over favikoner, manifest og service worker", () => {
    for (const pathname of [
      "/favicon.ico",
      "/favicon.svg",
      "/favicon-32x32.png",
      "/apple-touch-icon.png",
      "/android-chrome-192x192.png",
      "/maskable-512x512.png",
      "/manifest.webmanifest",
      "/sw.js",
      "/offline.js",
      "/uploads/bilde.png",
    ]) {
      expect(matches(pathname), pathname).toBe(false);
    }
  });
});
