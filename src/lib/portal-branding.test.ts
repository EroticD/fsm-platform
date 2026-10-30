import { describe, expect, it } from "vitest";
import { portalBranding } from "./portal-branding";

describe("portalBranding", () => {
  it("bruker kundens gyldige farge og trygge logo", () => {
    expect(
      portalBranding({
        name: "Nordisk Anlegg",
        brandColor: "#AABBCC",
        logoUrl: "/uploads/kunde-logo.png",
      }),
    ).toEqual({
      color: "#aabbcc",
      logo: "/uploads/kunde-logo.png",
      initial: "N",
    });
  });

  it("avviser utrygg logo og ugyldig farge", () => {
    const branding = portalBranding({
      name: "",
      brandColor: "javascript:alert(1)",
      logoUrl: "https://evil.example/logo.png",
    });
    expect(branding.color).toBe("#d8ff3e");
    expect(branding.logo).toBeNull();
    expect(branding.initial).toBe("?");
  });
});
