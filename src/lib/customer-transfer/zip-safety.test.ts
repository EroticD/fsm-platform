import { describe, expect, it } from "vitest";
import { createZip, isSafeZipPath, readZip } from "@/lib/zip";
import { readPackage } from "@/lib/customer-transfer/read-package";

describe("ZIP-sikkerhet", () => {
  it("avviser absolutte baner, .., backslash, NUL og stasjoner", () => {
    expect(isSafeZipPath("../secret")).toBe(false);
    expect(isSafeZipPath("/etc/passwd")).toBe(false);
    expect(isSafeZipPath("a\\b")).toBe(false);
    expect(isSafeZipPath("a\u0000b")).toBe(false);
    expect(isSafeZipPath("C:/windows")).toBe(false);
    expect(isSafeZipPath("files/ab/abc.pdf")).toBe(true);
  });

  it("avviser dupliserte og utrygge baner ved skriving", () => {
    expect(() =>
      createZip([
        { path: "data/a.json", data: Buffer.from("1") },
        { path: "data/a.json", data: Buffer.from("2") },
      ]),
    ).toThrow(/Duplikat/);
    expect(() =>
      createZip([{ path: "../evil", data: Buffer.from("x") }]),
    ).toThrow(/Utrygg/);
  });

  it("avviser høy kompresjonsratio (zip-bombe)", () => {
    expect(() =>
      createZip([
        { path: "data/zeros.bin", data: Buffer.alloc(2 * 1024 * 1024) },
      ]),
    ).toThrow(/Kompresjonsforhold/);
  });

  it("leser et gyldig arkiv og bevarer komprimert størrelse", () => {
    const zip = createZip([
      { path: "data/a.json", data: Buffer.from('{"a":1}') },
    ]);
    const entries = readZip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("data/a.json");
    expect(entries[0].compressedSize).toBeGreaterThan(0);
  });

  it("avviser en pakke uten manifest", () => {
    const zip = createZip([{ path: "data/a.json", data: Buffer.from("[]") }]);
    const result = readPackage(zip);
    expect(result.ok).toBe(false);
  });

  it("avviser en tom buffer", () => {
    expect(readPackage(Buffer.alloc(0)).ok).toBe(false);
  });
});
