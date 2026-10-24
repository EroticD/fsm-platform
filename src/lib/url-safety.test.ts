import { describe, expect, it } from "vitest";
import { isPrivateIp, isSafeLogoUrl } from "./url-safety";

describe("isSafeLogoUrl", () => {
  it("godtar bare opplastede bildefiler", () => {
    expect(isSafeLogoUrl("/uploads/abc-123.png")).toBe(true);
    expect(isSafeLogoUrl("/uploads/abc-123.jpg")).toBe(true);
    expect(isSafeLogoUrl("/uploads/abc-123.webp")).toBe(true);
  });

  it("avviser eksterne, private og farlige URL-er", () => {
    expect(isSafeLogoUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeLogoUrl("https://example.com/logo.png")).toBe(false);
    expect(isSafeLogoUrl("/uploads/../secret.png")).toBe(false);
    expect(isSafeLogoUrl("/uploads/logo.svg")).toBe(false);
    expect(isSafeLogoUrl("data:image/png;base64,abc")).toBe(false);
    expect(isSafeLogoUrl("")).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("kjenner igjen private IPv4-områder", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
    ]) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it("tillater offentlige IPv4-adresser", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });

  it("kjenner igjen loopback og link-local IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });
});
