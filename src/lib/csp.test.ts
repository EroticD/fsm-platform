import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "./csp";

describe("buildCsp", () => {
  it("setter nonce og strict-dynamic på script", () => {
    const csp = buildCsp("abc123");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("har de øvrige direktivene", () => {
    const csp = buildCsp("n");
    for (const directive of [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.opentopomap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://api.maptiler.com https://api.mapbox.com https://*.tiles.mapbox.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("avviser inline-script uten nonce", () => {
    const csp = buildCsp("n");
    // Uten unsafe-inline (og med strict-dynamic) blokkeres et ukjent inline-script.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe("createNonce", () => {
  it("lager en ny, ikke-tom nonce hver gang", () => {
    const first = createNonce();
    const second = createNonce();
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
