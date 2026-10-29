import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from "./password-policy";

describe("validatePassword", () => {
  it("godtar et passord med minst 12 tegn", () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it("avviser for kort passord", () => {
    expect(validatePassword("kort")).toBe("too_short");
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      "too_short",
    );
  });

  it("avviser ledende og avsluttende mellomrom", () => {
    expect(validatePassword(" langt-passord ")).toBe("whitespace");
    expect(validatePassword("\tlangt-passord")).toBe("whitespace");
  });

  it("teller 72 byte, ikke 72 tegn", () => {
    expect(validatePassword("a".repeat(PASSWORD_MAX_BYTES))).toBeNull();
    expect(validatePassword("a".repeat(PASSWORD_MAX_BYTES + 1))).toBe(
      "too_long",
    );
    // Hvert «å» er to byte i UTF-8.
    expect(validatePassword("å".repeat(37))).toBe("too_long");
  });

  it("avviser ikke-tekst", () => {
    expect(validatePassword(null)).toBe("too_short");
    expect(validatePassword(123456789012)).toBe("too_short");
  });
});
