import { describe, expect, it } from "vitest";
import {
  buildChecksumsFile,
  contentAddressedPath,
  manifestSchema,
  parseChecksumsFile,
  stableJson,
} from "./manifest";
import { sha256Hex } from "@/lib/zip";

describe("customer transfer manifest", () => {
  it("serialiserer JSON deterministisk med sorterte nøkler", () => {
    const first = stableJson({ b: 2, a: { z: 1, y: 2 } }).toString("utf8");
    const second = stableJson({ a: { y: 2, z: 1 }, b: 2 }).toString("utf8");
    expect(first).toBe(second);
    expect(first.indexOf('"a"')).toBeLessThan(first.indexOf('"b"'));
  });

  it("bevarer array-rekkefølge (eksporten sorterer selv)", () => {
    expect(stableJson([{ id: "b" }, { id: "a" }]).toString("utf8")).toContain(
      '"id": "b"',
    );
  });

  it("skriver og leser sha256sum-kompatibel sjekksumfil", () => {
    const checksums = {
      "data/b.json": sha256Hex("b"),
      "data/a.json": sha256Hex("a"),
    };
    const text = buildChecksumsFile(checksums).toString("utf8");
    expect(text.split("\n")[0]).toContain("data/a.json");
    expect(parseChecksumsFile(text)).toEqual(new Map(Object.entries(checksums)));
  });

  it("bruker innholdsadresserte filbaner", () => {
    const hash = "ab".repeat(32);
    expect(contentAddressedPath(hash, "pdf")).toBe(`files/ab/${hash}.pdf`);
  });

  it("avviser ukjent format og ugyldig schema", () => {
    const result = manifestSchema.safeParse({
      format: "something-else",
      schemaVersion: "1.0",
    });
    expect(result.success).toBe(false);
  });

  it("godtar et minimalt gyldig manifest", () => {
    const result = manifestSchema.safeParse({
      format: "fsm-customer-export",
      schemaVersion: "1.0",
      exportedAt: "2026-11-03T10:00:00.000Z",
      source: { instanceId: "test", appVersion: "0.8.5" },
      scope: {
        customerIds: ["c1"],
        includeFiles: true,
        includeDeleted: false,
        includeLegalHold: false,
        includeAudit: true,
        includeSignatures: false,
      },
      counts: { customers: 1, files: 0 },
      files: [],
      checksums: {},
      totals: { dataBytes: 1, fileBytes: 0, entries: 4 },
    });
    expect(result.success).toBe(true);
  });
});
