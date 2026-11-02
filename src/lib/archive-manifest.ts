// i18n-ignore-file: verifiseringsfeil er tekniske arkivfeil, ikke UI-tekst.
import { createHmac } from "node:crypto";
import {
  createZip,
  readZip,
  sha256Hex,
  type ZipEntry,
  type ZipEntryInput,
} from "@/lib/zip";

/**
 * Felles manifest- og signaturformat for eksportarkivene.
 *
 * Alle filer hashes med SHA-256. `manifest.sha256` forsegler manifestet, slik
 * at en endring i både en fil og manifestet oppdages. Når
 * `AUDIT_EXPORT_SIGNING_KEY` er satt, legges en HMAC-signatur i `manifest.sig`
 * i tillegg. Nøkkelen havner aldri i arkivet.
 */

export type ArchiveManifestFile = {
  path: string;
  sha256: string;
  size: number;
  /** F.eks. «report», «attachment», «audit». */
  kind?: string;
};

export type ArchiveMissingFile = {
  path: string;
  reason: string;
};

export type ArchiveManifest = {
  version: 1;
  kind: string;
  generatedAt: string;
  generator: string;
  files: ArchiveManifestFile[];
  missing: ArchiveMissingFile[];
  [key: string]: unknown;
};

export type ArchiveFileInput = {
  path: string;
  data: Buffer;
  kind?: string;
};

export type BuildArchiveOptions = {
  kind: string;
  files: ArchiveFileInput[];
  missing?: ArchiveMissingFile[];
  /** Ekstra toppnivåfelt i manifestet. Må ikke inneholde hemmeligheter. */
  metadata?: Record<string, unknown>;
  signingKey?: string | null;
  generatedAt?: Date;
};

export type BuiltArchive = {
  buffer: Buffer;
  manifest: ArchiveManifest;
  signature: string | null;
};

export function archiveSigningKey(): string | null {
  const key = process.env.AUDIT_EXPORT_SIGNING_KEY;
  return key && key.length >= 16 ? key : null;
}

/** Sorterer filer og bygger manifestet. Kalleren har allerede validert baner. */
export function buildArchive({
  kind,
  files,
  missing = [],
  metadata = {},
  signingKey = null,
  generatedAt = new Date(),
}: BuildArchiveOptions): BuiltArchive {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const manifest: ArchiveManifest = {
    version: 1,
    kind,
    generatedAt: generatedAt.toISOString(),
    generator: "fsm-platform",
    ...metadata,
    files: sorted.map((file) => ({
      path: file.path,
      sha256: sha256Hex(file.data),
      size: file.data.length,
      ...(file.kind ? { kind: file.kind } : {}),
    })),
    missing: [...missing].sort((a, b) => a.path.localeCompare(b.path)),
  };

  const manifestJson = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const manifestDigest = sha256Hex(manifestJson);
  const signature = signingKey
    ? createHmac("sha256", signingKey).update(manifestJson).digest("hex")
    : null;

  const entries: ZipEntryInput[] = sorted.map((file) => ({
    path: file.path,
    data: file.data,
    modifiedAt: generatedAt,
  }));
  entries.push(
    { path: "manifest.json", data: manifestJson, modifiedAt: generatedAt },
    {
      path: "manifest.sha256",
      data: Buffer.from(`${manifestDigest}  manifest.json\n`, "utf8"),
      modifiedAt: generatedAt,
    },
  );
  if (signature) {
    entries.push({
      path: "manifest.sig",
      data: Buffer.from(`hmac-sha256=${signature}\n`, "utf8"),
      modifiedAt: generatedAt,
    });
  }

  return { buffer: createZip(entries), manifest, signature };
}

export type ArchiveVerification = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest: ArchiveManifest | null;
  entries: ZipEntry[];
};

function findEntry(entries: readonly ZipEntry[], path: string): ZipEntry | null {
  return entries.find((entry) => entry.path === path) ?? null;
}

/**
 * Verifiserer et arkiv uten database- eller nettverkstilgang. Returnerer alle
 * feil i stedet for å stoppe ved den første, slik at en administrator kan se
 * hva som er galt med en innsendt bevispakke.
 */
export function verifyArchive(
  buffer: Buffer,
  options: { signingKey?: string | null } = {},
): ArchiveVerification {
  const errors: string[] = [];
  const warnings: string[] = [];
  let entries: ZipEntry[];
  try {
    entries = readZip(buffer);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
      manifest: null,
      entries: [],
    };
  }

  const manifestEntry = findEntry(entries, "manifest.json");
  const digestEntry = findEntry(entries, "manifest.sha256");
  if (!manifestEntry || !digestEntry) {
    return {
      ok: false,
      errors: ["Arkivet mangler manifest.json eller manifest.sha256"],
      warnings,
      manifest: null,
      entries,
    };
  }

  const expectedDigest = digestEntry.data
    .toString("utf8")
    .trim()
    .split(/\s+/)[0];
  const actualDigest = sha256Hex(manifestEntry.data);
  if (expectedDigest !== actualDigest) {
    errors.push("manifest.sha256 stemmer ikke med manifest.json");
  }

  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf8")) as ArchiveManifest;
  } catch {
    return {
      ok: false,
      errors: [...errors, "manifest.json er ikke gyldig JSON"],
      warnings,
      manifest: null,
      entries,
    };
  }

  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    errors.push("Ukjent eller ufullstendig manifest");
    return { ok: false, errors, warnings, manifest, entries };
  }

  const listed = new Set<string>();
  for (const file of manifest.files) {
    listed.add(file.path);
    const entry = findEntry(entries, file.path);
    if (!entry) {
      errors.push(`Mangler fil: ${file.path}`);
      continue;
    }
    const digest = sha256Hex(entry.data);
    if (digest !== file.sha256) {
      errors.push(`Hash stemmer ikke for ${file.path}`);
    }
    if (entry.data.length !== file.size) {
      errors.push(`Størrelse stemmer ikke for ${file.path}`);
    }
  }

  for (const entry of entries) {
    if (
      entry.path === "manifest.json" ||
      entry.path === "manifest.sha256" ||
      entry.path === "manifest.sig"
    ) {
      continue;
    }
    if (!listed.has(entry.path)) {
      errors.push(`Fil mangler i manifestet: ${entry.path}`);
    }
  }

  const signatureEntry = findEntry(entries, "manifest.sig");
  const signingKey = options.signingKey ?? archiveSigningKey();
  if (signatureEntry) {
    if (!signingKey) {
      warnings.push("Arkivet er signert, men ingen signeringsnøkkel er oppgitt");
    } else {
      const expected = createHmac("sha256", signingKey)
        .update(manifestEntry.data)
        .digest("hex");
      const actual = signatureEntry.data
        .toString("utf8")
        .trim()
        .replace(/^hmac-sha256=/, "");
      if (expected !== actual) errors.push("Signatur stemmer ikke");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    entries,
  };
}
