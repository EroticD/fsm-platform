// i18n-ignore-file: manifestfelt og tekniske stier er data, ikke UI-tekst.
import { z } from "zod";
import { sha256Hex } from "@/lib/zip";
import {
  ALLOWED_MIME_SET,
  TRANSFER_FORMAT,
  TRANSFER_SCHEMA_VERSION,
  TRANSFER_SUPPORTED_SCHEMA_VERSIONS,
} from "./constants";
import { isSupportedSchemaVersion } from "./schema-version";

/** Rekursiv sortering av objektnøkler. Array-rekkefølge bevares (kalleren sorterer). */
export function sortKeysDeep(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    return sortKeysDeep((value as { toJSON: () => unknown }).toJSON());
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = sortKeysDeep(source[key]);
    }
    return result;
  }
  return value;
}

/** Kanonisk JSON: UTF-8, sorterte nøkler, to mellomrom og avsluttende newline. */
export function stableJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(sortKeysDeep(value), null, 2)}\n`, "utf8");
}

export function buildChecksumsFile(checksums: Record<string, string>): Buffer {
  const lines = Object.keys(checksums)
    .sort()
    .map((path) => `${checksums[path]}  ${path}`);
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

export function parseChecksumsFile(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64}) [ *](.+)$/i.exec(line);
    if (!match) continue;
    result.set(match[2], match[1].toLowerCase());
  }
  return result;
}

/** Banenavn i en kundepakke: <first two hex>/<sha256>.<ext>. */
export function contentAddressedPath(sha256: string, extension: string): string {
  return `files/${sha256.slice(0, 2)}/${sha256}.${extension}`;
}

const SHA256 = /^[a-f0-9]{64}$/;
const FILE_PATH =
  /^files\/[a-f0-9]{2}\/[a-f0-9]{64}\.(pdf|jpg|jpeg|png|webp|gif)$/;

export const manifestFileSchema = z.object({
  path: z.string().regex(FILE_PATH),
  sha256: z.string().regex(SHA256),
  size: z.number().int().nonnegative(),
  mimeType: z.string().refine((value) => ALLOWED_MIME_SET.has(value)),
  kind: z.string().min(1).max(64),
  originalName: z.string().max(255).optional(),
  sourceUrl: z.string().max(2048).optional(),
  sourceEntityType: z.string().max(64).optional(),
  sourceEntityId: z.string().max(128).optional(),
  references: z
    .array(
      z.object({
        kind: z.string().max(64),
        sourceEntityType: z.string().max(64),
        sourceEntityId: z.string().max(128),
        originalName: z.string().max(255).optional(),
      }),
    )
    .optional(),
});

export const manifestSchema = z.object({
  format: z.literal(TRANSFER_FORMAT),
  schemaVersion: z.string().regex(/^\d+\.\d+$/),
  /** Påkrevd fra 1.1; eldre 1.0-pakker får en deterministisk verdi ved migrering. */
  packageId: z.string().min(1).max(128).optional(),
  exportedAt: z.string().datetime(),
  source: z.object({
    instanceId: z.string().min(1).max(128),
    appVersion: z.string().max(64),
    baseUrl: z.string().max(512).optional(),
    databaseLabel: z.string().max(64).optional(),
  }),
  scope: z.object({
    customerIds: z.array(z.string().min(1).max(128)).min(1),
    includeFiles: z.boolean(),
    includeDeleted: z.boolean(),
    includeLegalHold: z.boolean(),
    includeAudit: z.boolean(),
    includeSignatures: z.boolean(),
  }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  files: z.array(manifestFileSchema),
  checksums: z.record(z.string(), z.string().regex(SHA256)),
  totals: z.object({
    dataBytes: z.number().int().nonnegative(),
    fileBytes: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
  }),
});

export type TransferManifest = z.infer<typeof manifestSchema>;

export function supportedSchemaVersion(version: string): boolean {
  // Eksplisitt liste, ikke bare major: en fremtidig 1.2 skal avvises til
  // noen har skrevet og testet en migrering.
  return isSupportedSchemaVersion(version);
}

export { TRANSFER_SUPPORTED_SCHEMA_VERSIONS };

export function manifestChecksum(manifest: TransferManifest): string {
  // Manifestet sjekksummeres ikke selv; denne verdien brukes bare til å binde
  // forhåndsvisningen til pakken sammen med ZIP-ens egen SHA-256.
  return sha256Hex(Buffer.from(JSON.stringify(manifest), "utf8"));
}

export { TRANSFER_FORMAT, TRANSFER_SCHEMA_VERSION };
