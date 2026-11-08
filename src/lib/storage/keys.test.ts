import { describe, expect, it } from "vitest";
import {
  contentTypeForKey,
  isInternalStorageKey,
  matchesPrefix,
  normaliseStorageKey,
  storageKeyFromUploadUrl,
  storedNameFromUploadUrl,
  uploadUrlForKey,
} from "./keys";

describe("lagringsnøkler", () => {
  it("bevarer eksisterende /uploads-URL-er som rotnøkler", () => {
    expect(storedNameFromUploadUrl("/uploads/abc-123.pdf")).toBe("abc-123.pdf");
    expect(storageKeyFromUploadUrl("/uploads/abc-123.pdf")).toBe("abc-123.pdf");
    expect(uploadUrlForKey("abc-123.pdf")).toBe("/uploads/abc-123.pdf");
  });

  it("avviser URL-er som ikke er en enkel fil i opplastingsroten", () => {
    expect(storedNameFromUploadUrl("/uploads/../etc/passwd")).toBeNull();
    expect(storedNameFromUploadUrl("/uploads/a/b.pdf")).toBeNull();
    expect(storedNameFromUploadUrl("https://evil.example/a.pdf")).toBeNull();
    expect(() => uploadUrlForKey("mappe/a.pdf")).toThrow();
  });

  it("normaliserer nøkler men avviser traversal og absolutte stier", () => {
    expect(normaliseStorageKey(".transfer/job-1/package.zip")).toBe(
      ".transfer/job-1/package.zip",
    );
    for (const bad of [
      "",
      "/etc/passwd",
      "../secret",
      "a/../../secret",
      "a//b",
      "a\\b",
      "a/\u0000b",
    ]) {
      expect(() => normaliseStorageKey(bad)).toThrow();
    }
  });

  it("bruker prefiks på segmentgrense", () => {
    expect(matchesPrefix(".transfer/a/package.zip", ".transfer")).toBe(true);
    expect(matchesPrefix(".transfer/a/package.zip", ".transfer/a")).toBe(true);
    expect(matchesPrefix(".transferx/a", ".transfer")).toBe(false);
  });

  it("merker interne stagingnøkler", () => {
    expect(isInternalStorageKey(".transfer/job/package.zip")).toBe(true);
    expect(isInternalStorageKey("fil.pdf")).toBe(false);
  });

  it("utleder innholdstype fra endelsen", () => {
    expect(contentTypeForKey("a.PDF")).toBe("application/pdf");
    expect(contentTypeForKey("a.png")).toBe("image/png");
    expect(contentTypeForKey("a.bin")).toBe("application/octet-stream");
  });
});
