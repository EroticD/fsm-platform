import { describe, expect, it } from "vitest";
import {
  TRANSFER_SCHEMA_VERSION,
  TRANSFER_SUPPORTED_SCHEMA_VERSIONS,
} from "./constants";
import { supportedSchemaVersion } from "./manifest";
import {
  canMigrateToCurrent,
  derivedPackageId,
  isSupportedSchemaVersion,
  migrateManifestToCurrent,
} from "./schema-version";

function manifest(version: string) {
  return {
    format: "fsm-customer-export",
    schemaVersion: version,
    exportedAt: "2026-01-01T00:00:00.000Z",
    source: { instanceId: "instance", appVersion: "0.8.10" },
    scope: { customerIds: ["c1"] },
    counts: { customers: 1 },
  };
}

describe("pakkeversjoner", () => {
  it("har en eksplisitt støttet liste og en gjeldende versjon", () => {
    expect(TRANSFER_SCHEMA_VERSION).toBe("1.1");
    expect(TRANSFER_SUPPORTED_SCHEMA_VERSIONS).toEqual(["1.0", "1.1"]);
    expect(supportedSchemaVersion("1.0")).toBe(true);
    expect(supportedSchemaVersion("1.1")).toBe(true);
    expect(supportedSchemaVersion("1.2")).toBe(false);
    expect(supportedSchemaVersion("2.0")).toBe(false);
    expect(isSupportedSchemaVersion("0.9")).toBe(false);
  });

  it("migrerer 1.0 til 1.1 deterministisk med packageId", () => {
    const first = migrateManifestToCurrent(manifest("1.0"));
    const second = migrateManifestToCurrent(manifest("1.0"));
    expect(first.manifest.schemaVersion).toBe("1.1");
    expect(first.applied).toEqual(["1.0->1.1"]);
    expect(first.manifest.packageId).toBe(
      derivedPackageId(manifest("1.0") as never),
    );
    expect(second.manifest.packageId).toBe(first.manifest.packageId);
  });

  it("er en no-op for gjeldende versjon", () => {
    const result = migrateManifestToCurrent(manifest("1.1"));
    expect(result.applied).toEqual([]);
    expect(result.migratedFrom).toBeNull();
  });

  it("avviser fremtidige versjoner og manglende migreringssteg", () => {
    expect(canMigrateToCurrent("2.0")).toBe(false);
    expect(() => migrateManifestToCurrent(manifest("2.0"))).toThrow(
      /unsupported_schema/,
    );
  });
});
