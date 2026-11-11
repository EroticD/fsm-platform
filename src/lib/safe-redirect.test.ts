import { describe, expect, it } from "vitest";
import {
  safeLoginCallbackTarget,
  safeRelativeTarget,
} from "./safe-redirect";

describe("safeRelativeTarget", () => {
  it("beholder vanlige relative stier med query og hash", () => {
    expect(safeRelativeTarget("/kunder?x=1#a")).toBe("/kunder?x=1#a");
    expect(safeRelativeTarget("/oppdrag/abc")).toBe("/oppdrag/abc");
  });

  it("gjør absolutte URL-er om til en relativ sti", () => {
    expect(safeRelativeTarget("https://example.test/kunder?x=1#a")).toBe(
      "/kunder?x=1#a",
    );
    expect(safeRelativeTarget("http://example.test/")).toBe("/");
  });

  it.each([
    "//evil.example",
    "/..//evil.example",
    "/a/..//evil.example",
    "/.//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "data:text/html,hei",
  ])("avviser utenforliggende mål: %s", (value) => {
    expect(safeRelativeTarget(value)).toBe("/");
  });

  it("returnerer / for tomme verdier", () => {
    expect(safeRelativeTarget(null)).toBe("/");
    expect(safeRelativeTarget("")).toBe("/");
  });
});

describe("safeLoginCallbackTarget", () => {
  it.each([
    "/kunder",
    "/kunder?x=1#a",
    "/oppdrag/abc",
    "/mine-oppdrag",
    "/kundeportal",
  ])("beholder trygge callback-mål: %s", (value) => {
    expect(safeLoginCallbackTarget(value)).toBe(value);
  });

  it("beholder absolutte URL-er som trygge relative stier", () => {
    expect(safeLoginCallbackTarget("https://example.test/kunder?x=1#a")).toBe(
      "/kunder?x=1#a",
    );
  });

  it.each([
    "/logg-inn",
    "/logg-inn/",
    "/logg-inn/2fa",
    "/logg-inn/2fa/oppsett",
    "/logg-inn?error=CredentialsSignin",
    "/logg-inn/2fa?callbackUrl=%2Fkunder#topp",
    "/api/auth",
    "/api/auth/",
    "/api/auth/signin",
    "/api/auth/signin?callbackUrl=%2Fkunder",
    "/api/auth/callback/credentials#x",
    "/api/auth/session?x=1",
    "https://example.test/logg-inn",
    "https://example.test/api/auth/signin?callbackUrl=%2Fkunder",
  ])("avviser tilbakeføring til login/NextAuth: %s", (value) => {
    expect(safeLoginCallbackTarget(value)).toBe("/");
  });

  it("avviser utenforliggende mål på samme måte som safeRelativeTarget", () => {
    expect(safeLoginCallbackTarget("//evil.example/logg-inn")).toBe("/");
    expect(safeLoginCallbackTarget("/\\evil.example")).toBe("/");
    expect(safeLoginCallbackTarget("javascript:alert(1)")).toBe("/");
  });

  it("avviser ikke stier som bare ligner på /api/auth", () => {
    expect(safeLoginCallbackTarget("/api/authorization")).toBe(
      "/api/authorization",
    );
    expect(safeLoginCallbackTarget("/logg-innsikt")).toBe("/logg-innsikt");
  });

  it("returnerer / for tomme verdier", () => {
    expect(safeLoginCallbackTarget(null)).toBe("/");
    expect(safeLoginCallbackTarget(undefined)).toBe("/");
    expect(safeLoginCallbackTarget("")).toBe("/");
  });
});
