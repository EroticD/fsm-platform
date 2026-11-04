import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

function headerValue(key: string): string | undefined {
  return securityHeaders().find((header) => header.key === key)?.value;
}

describe("Permissions-Policy", () => {
  const policy = headerValue("Permissions-Policy") ?? "";

  it("tillater kamera for appens eget opphav", () => {
    const camera = policy
      .split(",")
      .map((part) => part.trim())
      .find((part) => part.startsWith("camera="));
    expect(camera).toBe("camera=(self)");
  });

  it("blokkerer ikke lenger kameraet for alle", () => {
    expect(policy).not.toContain("camera=()");
    expect(policy).not.toContain("camera=*");
  });

  it("holder mikrofonen av og geolocation begrenset til eget opphav", () => {
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=(self)");
  });
});

describe("øvrige sikkerhetsheadere", () => {
  it("beholder nosniff, frame-vern og HSTS", () => {
    expect(headerValue("X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(headerValue("Strict-Transport-Security")).toContain(
      "includeSubDomains",
    );
  });
});
