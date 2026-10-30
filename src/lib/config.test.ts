import { describe, expect, it } from "vitest";
import {
  isStrongNextAuthSecret,
  MIN_NEXTAUTH_SECRET_BYTES,
  validateProductionConfig,
} from "./config";

// Lang og variert nok til å representere en ekte `openssl rand -base64 32`.
const STRONG_SECRET = "8fK2qZ7mN4vR9xT1cB6wY3pL5sH0jG2dA7eU4iO9kM1n";

describe("isStrongNextAuthSecret", () => {
  it("godtar en lang, variert hemmelighet", () => {
    expect(Buffer.byteLength(STRONG_SECRET)).toBeGreaterThanOrEqual(
      MIN_NEXTAUTH_SECRET_BYTES,
    );
    expect(isStrongNextAuthSecret(STRONG_SECRET)).toBe(true);
  });

  it("godtar en lang passfrase med bindestrek", () => {
    expect(
      isStrongNextAuthSecret(
        "Example-Passphrase9-Not-A-Real-Secret-For-Tests-Only",
      ),
    ).toBe(true);
  });

  it("avviser korte og kjente standardverdier", () => {
    expect(isStrongNextAuthSecret("secret")).toBe(false);
    expect(isStrongNextAuthSecret("changeme")).toBe(false);
    expect(isStrongNextAuthSecret("a".repeat(64))).toBe(false);
    expect(
      isStrongNextAuthSecret("bytt-meg-med-openssl-rand-base64-32"),
    ).toBe(false);
  });

  it("avviser tom og manglende hemmelighet", () => {
    expect(isStrongNextAuthSecret(undefined)).toBe(false);
    expect(isStrongNextAuthSecret("   ")).toBe(false);
  });
});

describe("validateProductionConfig", () => {
  it("ignorerer utviklingsmiljø", () => {
    expect(
      validateProductionConfig({
        NODE_ENV: "development",
        NEXTAUTH_URL: "http://x",
        NEXTAUTH_SECRET: "secret",
      }),
    ).toEqual([]);
  });

  it("krever https i produksjon", () => {
    const errors = validateProductionConfig({
      NODE_ENV: "production",
      NEXTAUTH_URL: "http://fsm.example",
      NEXTAUTH_SECRET: STRONG_SECRET,
    });
    expect(errors.join(" ")).toContain("https://");
  });

  it("godtar http på localhost i produksjon for lokal forhåndsvisning", () => {
    expect(
      validateProductionConfig({
        NODE_ENV: "production",
        NEXTAUTH_URL: "http://127.0.0.1:3100",
        NEXTAUTH_SECRET: STRONG_SECRET,
      }),
    ).toEqual([]);
  });

  it("godtar gyldig produksjonskonfigurasjon", () => {
    expect(
      validateProductionConfig({
        NODE_ENV: "production",
        NEXTAUTH_URL: "https://fsm.example",
        APP_URL: "https://fsm.example",
        NEXTAUTH_SECRET: STRONG_SECRET,
      }),
    ).toEqual([]);
  });

  it("avviser kort NEXTAUTH_SECRET i produksjon", () => {
    const errors = validateProductionConfig({
      NODE_ENV: "production",
      NEXTAUTH_URL: "https://fsm.example",
      NEXTAUTH_SECRET: "secret",
    });
    expect(errors.join(" ")).toContain("NEXTAUTH_SECRET");
  });

  it("avviser kjent standardverdi selv når den er lang nok", () => {
    const errors = validateProductionConfig({
      NODE_ENV: "production",
      NEXTAUTH_URL: "https://fsm.example",
      NEXTAUTH_SECRET: "bytt-meg-med-openssl-rand-base64-32",
    });
    expect(errors.join(" ")).toContain("NEXTAUTH_SECRET");
  });

  it("krever NEXTAUTH_SECRET når den mangler", () => {
    const errors = validateProductionConfig({
      NODE_ENV: "production",
      NEXTAUTH_URL: "https://fsm.example",
    });
    expect(errors.join(" ")).toContain("NEXTAUTH_SECRET is missing");
  });
});
