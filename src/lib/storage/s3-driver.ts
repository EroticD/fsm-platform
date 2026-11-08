// i18n-ignore-file: S3-driverens feil og logger er driftsdata.
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { matchesPrefix, normaliseStorageKey } from "./keys";
import type {
  StorageDriver,
  StorageObject,
  StorageStreamOptions,
  StorageWriteOptions,
} from "./types";

export type S3StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  serverSideEncryption?: string;
  kmsKeyId?: string;
};

/**
 * Minste overflate vi trenger fra S3-klienten. Testene injiserer en falsk
 * klient, slik at enhetstestene aldri krever nettverk eller AWS-legitimasjon.
 */
export type S3ClientLike = {
  send(command: unknown): Promise<unknown>;
};

type S3Error = Error & {
  name?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
};

function isNotFound(error: unknown): boolean {
  const candidate = error as S3Error;
  return (
    candidate?.$metadata?.httpStatusCode === 404 ||
    candidate?.name === "NotFound" ||
    candidate?.name === "NoSuchKey" ||
    candidate?.Code === "NoSuchKey" ||
    candidate?.Code === "NotFound"
  );
}

function normalisePrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return normaliseStorageKey(trimmed);
}

/**
 * S3/MinIO-driver. Alle objekter ligger under `S3_PREFIX` (valgfritt), men
 * nøkkelen appen ser er alltid relativ – det er den som lagres i databasen og
 * som `/uploads/<navn>` oversettes til.
 */
export class S3StorageDriver implements StorageDriver {
  readonly kind = "s3" as const;
  private readonly client: S3ClientLike;
  private readonly prefix: string;

  constructor(
    private readonly config: S3StorageConfig,
    client?: S3ClientLike,
  ) {
    this.prefix = normalisePrefix(config.prefix);
    this.client =
      client ??
      new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
                ...(config.sessionToken
                  ? { sessionToken: config.sessionToken }
                  : {}),
              },
            }
          : {}),
      });
  }

  private objectKey(key: string): string {
    const normalised = normaliseStorageKey(key);
    return this.prefix ? `${this.prefix}/${normalised}` : normalised;
  }

  private relativeKey(objectKey: string): string {
    if (!this.prefix) return objectKey;
    if (objectKey === this.prefix) return "";
    return objectKey.startsWith(`${this.prefix}/`)
      ? objectKey.slice(this.prefix.length + 1)
      : objectKey;
  }

  private putOptions(options?: StorageWriteOptions) {
    const serverSideEncryption =
      options?.serverSideEncryption ?? this.config.serverSideEncryption;
    const kmsKeyId = options?.kmsKeyId ?? this.config.kmsKeyId;
    return {
      ...(options?.contentType ? { ContentType: options.contentType } : {}),
      ...(options?.cacheControl ? { CacheControl: options.cacheControl } : {}),
      ...(options?.metadata ? { Metadata: options.metadata } : {}),
      ...(serverSideEncryption
        ? { ServerSideEncryption: serverSideEncryption as never }
        : {}),
      ...(kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
    };
  }

  async read(key: string): Promise<Buffer> {
    const result = (await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
      }),
    )) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } | null };
    if (!result.Body?.transformToByteArray) {
      throw new Error("S3 svarte uten innhold");
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async write(
    key: string,
    data: Buffer | Uint8Array | string,
    options?: StorageWriteOptions,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
        Body: data,
        ...this.putOptions(options),
      }),
    );
  }

  async writeFromFile(
    key: string,
    sourcePath: string,
    options?: StorageWriteOptions,
  ): Promise<void> {
    const info = await fs.stat(sourcePath);
    if (!info.isFile()) throw new Error("Kilden er ikke en fil");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
        Body: createReadStream(sourcePath),
        ContentLength: info.size,
        ...this.putOptions(options),
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
      }),
    );
  }

  async stat(key: string): Promise<StorageObject | null> {
    try {
      const result = (await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey(key),
        }),
      )) as {
        ContentLength?: number;
        LastModified?: Date;
        ContentType?: string;
      };
      return {
        key: normaliseStorageKey(key),
        size: result.ContentLength ?? 0,
        lastModified: result.LastModified ?? null,
        contentType: result.ContentType ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async list(prefix?: string): Promise<StorageObject[]> {
    const relativePrefix = prefix ? normaliseStorageKey(prefix) : "";
    const fullPrefix = relativePrefix
      ? this.prefix
        ? `${this.prefix}/${relativePrefix}/`
        : `${relativePrefix}/`
      : this.prefix
        ? `${this.prefix}/`
        : "";
    const results: StorageObject[] = [];
    let token: string | undefined;

    do {
      const result = (await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: fullPrefix || undefined,
          ContinuationToken: token,
        }),
      )) as {
        Contents?: Array<{
          Key?: string;
          Size?: number;
          LastModified?: Date;
        }>;
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };

      for (const item of result.Contents ?? []) {
        if (!item.Key) continue;
        const key = this.relativeKey(item.Key);
        if (!key || !matchesPrefix(key, relativePrefix)) continue;
        results.push({
          key,
          size: item.Size ?? 0,
          lastModified: item.LastModified ?? null,
          contentType: null,
        });
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);

    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  async stream(
    key: string,
    options?: StorageStreamOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    // S3 Range er inklusiv; `end` er derfor siste byte, ikke eksklusiv.
    const range =
      options?.start !== undefined || options?.end !== undefined
        ? `bytes=${options.start ?? 0}-${options.end ?? ""}`
        : undefined;

    const result = (await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
        ...(range ? { Range: range } : {}),
      }),
    )) as {
      Body?: {
        transformToWebStream?: () => ReadableStream<Uint8Array>;
        pipe?: unknown;
      } | null;
    };

    const body = result.Body;
    if (!body) throw new Error("S3 svarte uten innhold");
    if (typeof body.transformToWebStream === "function") {
      return body.transformToWebStream();
    }
    if (typeof body.pipe === "function") {
      return Readable.toWeb(body as unknown as Readable) as unknown as ReadableStream<Uint8Array>;
    }
    throw new Error("S3-innholdet kan ikke strømmes");
  }

  async healthCheck(): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.config.bucket }),
    );
  }

  localPath(): string | null {
    return null;
  }
}
