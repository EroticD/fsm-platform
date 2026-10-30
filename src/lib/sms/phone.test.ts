import { describe, expect, it } from "vitest";
import { maskSmsPhone, normalizeSmsPhone, phonesMatch } from "./phone";

describe("SMS-telefonnumre", () => {
  it("normaliserer landkode og formatering", () => {
    expect(normalizeSmsPhone("+47 900 00 000")).toBe("4790000000");
    expect(normalizeSmsPhone("0047 900 00 000")).toBe("4790000000");
    expect(normalizeSmsPhone("900 00 000")).toBe("90000000");
    expect(normalizeSmsPhone(null)).toBe("");
  });

  it("matcher nasjonale og internasjonale former", () => {
    expect(phonesMatch("+47 900 00 000", "90000000")).toBe(true);
    expect(phonesMatch("+47 900 00 000", "+47 900 00 001")).toBe(false);
  });

  it("matcher ikke tomme eller for korte numre", () => {
    expect(phonesMatch("", "")).toBe(false);
    expect(phonesMatch("123", "123")).toBe(true);
    expect(phonesMatch("123", "9123")).toBe(false);
  });

  it("maskerer nummer i lister", () => {
    expect(maskSmsPhone("+4790000000")).toBe("47…0000");
  });
});
