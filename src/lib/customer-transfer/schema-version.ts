// i18n-ignore-file: skjemaversjoner og migreringer er tekniske data.
import { createHash } from "node:crypto";
import {
  TRANSFER_FORMAT,
  TRANSFER_SCHEMA_VERSION,
  TRANSFER_SUPPORTED_SCHEMA_VERSIONS,
} from "./constants";

/**
 * Eksplisitt støttede pakkeversjoner og deterministiske migreringer.
 *
 * Hovedregelen er at en pakke bare migreres mellom versjoner som er listet i
 * `TRANSFER_SUPPORTED_SCHEMA_VERSIONS`. Ukjente/fremtidige versjoner avvises
 * med stabil feilkode; vi gjetter aldri på betydningen av ukjente felt.
 *
 * `1.0 -> 1.1` legger til en deterministisk `packageId`. ID-en brukes bare som
 * proveniens/idempotensmarkør og inneholder ingen personopplysninger. Alle
 * andre felt beholdes uendret, slik at importens semantikk er den samme.
 */

export type MigratableManifest = Record<string, unknown> & {
  schemaVersion: string;
};

export type MigrationResult = {
  manifest: MigratableManifest;
  migratedFrom: string | null;
  applied: string[];
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Deterministisk ID for en 1.0-pakke som mangler `packageId`. */
export function derivedPackageId(manifest: Record<string, unknown>): string {
  const projection = {
    format: manifest.format ?? TRANSFER_FORMAT,
    exportedAt: manifest.exportedAt ?? null,
    source: manifest.source ?? null,
    scope: manifest.scope ?? null,
    counts: manifest.counts ?? null,
  };
  return createHash("sha256")
    .update(stableStringify(projection))
    .digest("hex")
    .slice(0, 32);
}

const MIGRATIONS: Record<
  string,
  (manifest: MigratableManifest) => MigratableManifest
> = {
  "1.0": (manifest) => ({
    ...manifest,
    schemaVersion: "1.1",
    packageId:
      typeof manifest.packageId === "string" && manifest.packageId
        ? manifest.packageId
        : derivedPackageId(manifest),
  }),
};

export function isSupportedSchemaVersion(version: string): boolean {
  return (TRANSFER_SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(
    version,
  );
}

/** Versjoner som kan migreres til gjeldende versjon. */
export function canMigrateToCurrent(version: string): boolean {
  if (version === TRANSFER_SCHEMA_VERSION) return true;
  if (!isSupportedSchemaVersion(version)) return false;
  let current = version;
  const visited = new Set<string>();
  while (current !== TRANSFER_SCHEMA_VERSION) {
    if (visited.has(current)) return false;
    visited.add(current);
    if (!MIGRATIONS[current]) return false;
    current = String(MIGRATIONS[current]({ schemaVersion: current }).schemaVersion);
  }
  return true;
}

export function migrateManifestToCurrent(
  manifest: MigratableManifest,
): MigrationResult {
  let current = manifest;
  const applied: string[] = [];
  const migratedFrom =
    current.schemaVersion === TRANSFER_SCHEMA_VERSION
      ? null
      : current.schemaVersion;
  const visited = new Set<string>();

  while (current.schemaVersion !== TRANSFER_SCHEMA_VERSION) {
    const version = current.schemaVersion;
    if (visited.has(version)) {
      throw new Error(`customer_transfer.migration_cycle:${version}`);
    }
    visited.add(version);
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(`customer_transfer.unsupported_schema:${version}`);
    }
    current = migrate(current);
    applied.push(`${version}->${String(current.schemaVersion)}`);
  }

  return { manifest: current, migratedFrom, applied };
}

export {
  TRANSFER_SCHEMA_VERSION,
  TRANSFER_SUPPORTED_SCHEMA_VERSIONS,
};
