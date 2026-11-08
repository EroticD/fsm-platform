// i18n-ignore-file: lagringslagets feilkoder og logger er driftsdata.
export type StorageDriverKind = "local" | "s3";

export type StorageWriteOptions = {
  contentType?: string;
  cacheControl?: string;
  /** S3 server-side encryption, for eksempel `AES256` eller `aws:kms`. */
  serverSideEncryption?: string;
  /** S3 KMS-nøkkel når `serverSideEncryption=aws:kms`. */
  kmsKeyId?: string;
  metadata?: Record<string, string>;
};

export type StorageObject = {
  key: string;
  size: number;
  lastModified: Date | null;
  contentType: string | null;
};

export type StorageStreamOptions = {
  start?: number;
  end?: number;
};

/**
 * Felles grensesnitt for opplastingslagret.
 *
 * Nøkler er relative og bruker alltid `/` som skilletegn. Roten tilsvarer
 * `UPLOAD_DIR` for lokal driver og `S3_PREFIX` for S3-driveren. Eksisterende
 * `/uploads/<filnavn>`-URL-er oversettes til nøkkelen `<filnavn>`; ingen
 * URL-er eller lagrede filnavn endres ved bytte av driver.
 */
export interface StorageDriver {
  readonly kind: StorageDriverKind;

  read(key: string): Promise<Buffer>;

  write(
    key: string,
    data: Buffer | Uint8Array | string,
    options?: StorageWriteOptions,
  ): Promise<void>;

  /**
   * Skriver en lokal fil uten å lese hele innholdet inn i minnet der driveren
   * støtter det. Brukes av opplastingsruten for store PDF-er.
   */
  writeFromFile(
    key: string,
    sourcePath: string,
    options?: StorageWriteOptions,
  ): Promise<void>;

  delete(key: string): Promise<void>;

  /** Returnerer null når objektet ikke finnes. */
  stat(key: string): Promise<StorageObject | null>;

  /** Lister objekter under et prefiks. Prefikset er en nøkkel, ikke en glob. */
  list(prefix?: string): Promise<StorageObject[]>;

  stream(
    key: string,
    options?: StorageStreamOptions,
  ): Promise<ReadableStream<Uint8Array>>;

  /** Kaster en feil når lagringen ikke er tilgjengelig eller skrivbar. */
  healthCheck(): Promise<void>;

  /**
   * Absolutt sti når driveren er lokal, ellers null. Brukes bare av verktøy
   * som må ha en fil på disk (pdftotext, tesseract). Tjenestelaget skal ikke
   * bygge forretningslogikk på denne.
   */
  localPath(key: string): string | null;
}
