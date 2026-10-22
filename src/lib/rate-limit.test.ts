import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
  resetLoginRateLimit,
} from "@/lib/rate-limit";

describe("login rate limit", () => {
  beforeEach(() => resetLoginRateLimit());

  it("sperrer en e-postkonto etter ti feil", () => {
    const key = "email:kari@firma.no";
    for (let i = 0; i < 9; i++) {
      recordLoginFailure(key, 10);
      expect(checkLoginRateLimit([key]).allowed).toBe(true);
    }
    recordLoginFailure(key, 10);

    const result = checkLoginRateLimit([key]);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("lar en delt IP tåle flere feil enn én konto", () => {
    const key = "ip:10.0.0.5";
    for (let i = 0; i < 29; i++) recordLoginFailure(key, 30);
    expect(checkLoginRateLimit([key]).allowed).toBe(true);
    recordLoginFailure(key, 30);
    expect(checkLoginRateLimit([key]).allowed).toBe(false);
  });

  it("nullstiller tellingen etter vellykket innlogging", () => {
    const key = "email:kari@firma.no";
    for (let i = 0; i < 10; i++) recordLoginFailure(key, 10);
    expect(checkLoginRateLimit([key]).allowed).toBe(false);

    clearLoginFailures([key]);
    expect(checkLoginRateLimit([key]).allowed).toBe(true);
  });

  it("sperrer hvis én av flere nøkler er sperret", () => {
    const email = "email:kari@firma.no";
    const ip = "ip:10.0.0.5";
    for (let i = 0; i < 10; i++) recordLoginFailure(email, 10);

    expect(checkLoginRateLimit([email, ip]).allowed).toBe(false);
  });
});

import { allowRequest, resetApiRateLimit } from "@/lib/rate-limit";

describe("api rate limit", () => {
  beforeEach(() => resetApiRateLimit());

  it("slipper gjennom opp til grensen og sperrer deretter", () => {
    const key = "upload:bruker1";
    for (let i = 0; i < 3; i++) {
      expect(allowRequest(key, 3, 60_000).allowed).toBe(true);
    }
    const blocked = allowRequest(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("holder nøkler atskilt", () => {
    expect(allowRequest("a", 1, 60_000).allowed).toBe(true);
    expect(allowRequest("a", 1, 60_000).allowed).toBe(false);
    expect(allowRequest("b", 1, 60_000).allowed).toBe(true);
  });
});
