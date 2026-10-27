import { beforeEach, describe, expect, it } from "vitest";
import {
  allowRequestMemory,
  resetMemoryLimitsForTests,
} from "./rate-limit-memory";

beforeEach(() => resetMemoryLimitsForTests());

describe("allowRequestMemory", () => {
  it("slipper gjennom under grensen og avviser over", () => {
    const now = 1_000;
    expect(allowRequestMemory("ready:1.2.3.4", 2, 60_000, now)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(allowRequestMemory("ready:1.2.3.4", 2, 60_000, now).allowed).toBe(true);

    const blocked = allowRequestMemory("ready:1.2.3.4", 2, 60_000, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("nullstiller vinduet når tiden er ute", () => {
    expect(allowRequestMemory("k", 1, 1_000, 0).allowed).toBe(true);
    expect(allowRequestMemory("k", 1, 1_000, 500).allowed).toBe(false);
    expect(allowRequestMemory("k", 1, 1_000, 1_001).allowed).toBe(true);
  });

  it("avviser når grensen er null", () => {
    expect(allowRequestMemory("k", 0, 1_000, 0).allowed).toBe(false);
  });
});
