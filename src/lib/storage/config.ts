// i18n-ignore-file: konfigurasjonsfeil er driftsdata, ikke UI-tekst.
import os from "node:os";
import path from "node:path";
import { LocalStorageDriver } from "./local-driver";
import { S3StorageDriver, type S3StorageConfig } from "./s3-driver";
import type { StorageDriver } from "./types";

export type StorageKind = "local" | "s3";

export type StorageConfig =
  | { driver: "local"; root: string }
  | { driver: "s3"; s3: S3StorageConfig };

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

export function storageKind(env: Record<string, string | undefined> = process.env): StorageKind {
  const raw = (env.STORAGE_DRIVER?.trim() || "local").toLowerCase();
  if (raw === "local" || raw === "s3") return raw;
  throw new Error(
    `Ugyldig STORAGE_DRIVER «${raw}». Gyldige verdier er local og s3.`,
  );
}

export function resolveUploadRoot(env: Record<string, string | undefined> = process.env): string {
  return env.UPLOAD_DIR
    ? path.resolve(env.UPLOAD_DIR)
    : path.join(process.cwd(), "uploads");
}

/**
 * Midlertidig mappe for multipart, OCR og PDF-verktøy. Ved S3 kan ikke
 * opplastingsroten brukes som skriveplass, siden den ikke finnes lokalt.
 */
export function uploadTempDir(env: Record<string, string | undefined> = process.env): string {
  if (env.UPLOAD_TEMP_DIR?.trim()) return path.resolve(env.UPLOAD_TEMP_DIR);
  return os.tmpdir();
}

export function s3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3StorageConfig {
  const bucket = (env.S3_BUCKET ?? "").trim();
  if (!bucket) {
    throw new Error(
      "STORAGE_DRIVER=s3 krever S3_BUCKET. Se docs/STORAGE.md.",
    );
  }

  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      "S3_ACCESS_KEY_ID og S3_SECRET_ACCESS_KEY må settes sammen. " +
        "Bruk IAM-rolle uten eksplisitte nøkler der det er mulig.",
    );
  }

  if (env.S3_REQUIRE_EXPLICIT_CREDENTIALS === "true" && !accessKeyId) {
    throw new Error(
      "S3_REQUIRE_EXPLICIT_CREDENTIALS=true, men S3_ACCESS_KEY_ID mangler.",
    );
  }

  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  if (endpoint && !/^https?:\/\//i.test(endpoint)) {
    throw new Error("S3_ENDPOINT må være en http(s)-URL.");
  }

  return {
    bucket,
    region: env.S3_REGION?.trim() || "eu-north-1",
    ...(endpoint ? { endpoint } : {}),
    // MinIO og de fleste S3-kompatible tjenester krever path-style. Med en
    // eksplisitt endpoint er det den trygge standarden.
    forcePathStyle: env.S3_FORCE_PATH_STYLE?.trim()
      ? truthy(env.S3_FORCE_PATH_STYLE)
      : Boolean(endpoint),
    prefix: env.S3_PREFIX?.trim() || undefined,
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
    ...(env.S3_SESSION_TOKEN?.trim()
      ? { sessionToken: env.S3_SESSION_TOKEN.trim() }
      : {}),
    ...(env.S3_SERVER_SIDE_ENCRYPTION?.trim()
      ? { serverSideEncryption: env.S3_SERVER_SIDE_ENCRYPTION.trim() }
      : {}),
    ...(env.S3_KMS_KEY_ID?.trim()
      ? { kmsKeyId: env.S3_KMS_KEY_ID.trim() }
      : {}),
  };
}

export function storageConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): StorageConfig {
  const driver = storageKind(env);
  return driver === "s3"
    ? { driver, s3: s3ConfigFromEnv(env) }
    : { driver, root: resolveUploadRoot(env) };
}

function configSignature(env: Record<string, string | undefined>): string {
  return JSON.stringify([
    storageKind(env),
    env.UPLOAD_DIR ?? "",
    env.S3_BUCKET ?? "",
    env.S3_REGION ?? "",
    env.S3_ENDPOINT ?? "",
    env.S3_FORCE_PATH_STYLE ?? "",
    env.S3_PREFIX ?? "",
    env.S3_ACCESS_KEY_ID ?? "",
    env.S3_SECRET_ACCESS_KEY ?? "",
    env.S3_SESSION_TOKEN ?? "",
    env.S3_SERVER_SIDE_ENCRYPTION ?? "",
    env.S3_KMS_KEY_ID ?? "",
  ]);
}

let cached: { signature: string; driver: StorageDriver } | null = null;

export function createStorageDriver(env: Record<string, string | undefined> = process.env): StorageDriver {
  const config = storageConfigFromEnv(env);
  return config.driver === "s3"
    ? new S3StorageDriver(config.s3)
    : new LocalStorageDriver(config.root);
}

/** Prosessens delte driver. Bygges på nytt når miljøbildet endres (tester). */
export function getStorageDriver(
  env: Record<string, string | undefined> = process.env,
): StorageDriver {
  const signature = configSignature(env);
  if (!cached || cached.signature !== signature) {
    cached = { signature, driver: createStorageDriver(env) };
  }
  return cached.driver;
}

export function resetStorageDriverForTests(): void {
  cached = null;
}
