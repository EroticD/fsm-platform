import { afterEach, describe, expect, it } from "vitest";
import {
  createStorageDriver,
  getStorageDriver,
  resetStorageDriverForTests,
  s3ConfigFromEnv,
  storageConfigFromEnv,
  storageKind,
  uploadTempDir,
} from "./config";

afterEach(() => {
  resetStorageDriverForTests();
});

describe("storage-konfigurasjon", () => {
  it("bruker lokal disk når STORAGE_DRIVER er unset", () => {
    expect(storageKind({})).toBe("local");
    expect(storageKind({ STORAGE_DRIVER: "" })).toBe("local");
    expect(storageConfigFromEnv({ UPLOAD_DIR: "/data/uploads" })).toEqual({
      driver: "local",
      root: "/data/uploads",
    });
    expect(createStorageDriver({}).kind).toBe("local");
  });

  it("avviser ukjent driver i stedet for å gjette", () => {
    expect(() => storageKind({ STORAGE_DRIVER: "azure" })).toThrow(
      "Ugyldig STORAGE_DRIVER",
    );
  });

  it("krever S3_BUCKET når S3 er valgt", () => {
    expect(() => s3ConfigFromEnv({ STORAGE_DRIVER: "s3" })).toThrow(
      "S3_BUCKET",
    );
  });

  it("avviser halvferdige nøkler", () => {
    expect(() =>
      s3ConfigFromEnv({
        S3_BUCKET: "fsm",
        S3_ACCESS_KEY_ID: "bare-id",
      }),
    ).toThrow("S3_SECRET_ACCESS_KEY");
    expect(() =>
      s3ConfigFromEnv({
        S3_BUCKET: "fsm",
        S3_SECRET_ACCESS_KEY: "bare-secret",
      }),
    ).toThrow("S3_ACCESS_KEY_ID");
  });

  it("kan kreve eksplisitte nøkler (ingen implisitt IAM-kjede)", () => {
    expect(() =>
      s3ConfigFromEnv({
        S3_BUCKET: "fsm",
        S3_REQUIRE_EXPLICIT_CREDENTIALS: "true",
      }),
    ).toThrow("S3_REQUIRE_EXPLICIT_CREDENTIALS");
  });

  it("bruker path-style automatisk med MinIO-endpoint", () => {
    expect(
      s3ConfigFromEnv({
        S3_BUCKET: "fsm",
        S3_ENDPOINT: "http://minio:9000",
      }),
    ).toMatchObject({
      bucket: "fsm",
      endpoint: "http://minio:9000",
      forcePathStyle: true,
      region: "eu-north-1",
    });
  });

  it("respekterer eksplisitt forcePathStyle=false", () => {
    expect(
      s3ConfigFromEnv({
        S3_BUCKET: "fsm",
        S3_ENDPOINT: "https://s3.example.com",
        S3_FORCE_PATH_STYLE: "false",
      }).forcePathStyle,
    ).toBe(false);
  });

  it("bygger S3-driver og cacher per miljøbilde", () => {
    resetStorageDriverForTests();
    const env = { STORAGE_DRIVER: "s3", S3_BUCKET: "fsm", S3_REGION: "eu-north-1" };
    const first = getStorageDriver(env);
    expect(first.kind).toBe("s3");
    expect(getStorageDriver(env)).toBe(first);
    expect(
      getStorageDriver({ ...env, S3_PREFIX: "annen" }),
    ).not.toBe(first);
  });

  it("bruker UPLOAD_TEMP_DIR når den er satt", () => {
    expect(uploadTempDir({ UPLOAD_TEMP_DIR: "/tmp/fsm" })).toBe("/tmp/fsm");
  });
});
