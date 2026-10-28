import { describe, expect, it } from "vitest";
import { validateProductionConfig } from "./config";

describe("validateProductionConfig", () => {
  it("ignorerer utviklingsmiljø", () => {
    expect(
      validateProductionConfig({ NODE_ENV: "development", NEXTAUTH_URL: "http://x" }),
    ).toEqual([]);
  });

  it("krever https i produksjon", () => {
    const errors = validateProductionConfig({
      NODE_ENV: "production",
      NEXTAUTH_URL: "http://fsm.example",
      NEXTAUTH_SECRET: "secret",
    });
    expect(errors.join(" ")).toContain("https://");
  });

  it("godtar http på localhost i produksjon for lokal forhåndsvisning", () => {
    expect(
      validateProductionConfig({
        NODE_ENV: "production",
        NEXTAUTH_URL: "http://127.0.0.1:3100",
        NEXTAUTH_SECRET: "secret",
      }),
    ).toEqual([]);
  });

  it("godtar gyldig produksjonskonfigurasjon", () => {
    expect(
      validateProductionConfig({
        NODE_ENV: "production",
        NEXTAUTH_URL: "https://fsm.example",
        APP_URL: "https://fsm.example",
        NEXTAUTH_SECRET: "secret",
      }),
    ).toEqual([]);
  });
});
