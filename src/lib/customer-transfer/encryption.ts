// i18n-ignore-file: krypteringsformat og KDF-parametre er tekniske data.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Valgfritt kryptert omslag rundt en kundepakke.
 *
 * ZIP-ens egen passordkryptering er svak og støttes bevisst ikke. I stedet
 * brukes et enkelt, versjonert omslag:
 *
 *   "FSM-TRANSFER-ENCRYPTED-V1\n"
 *   <4 byte header-lengde, little endian>
 *   <header JSON>
 *   <AES-256-GCM ciphertext>
 *   <16 byte authentication tag>
 *
 * Nøkkelen utledes med scrypt (N=32768, r=8, p=1) fra en passfrase og et
 * tilfeldig salt. AES-GCM gir både konfidensialitet og integritet: feil
 * passfrase, endret header eller endret ciphertext avvises før pakken parses.
 *
 * Passfrasen lagres aldri i databasen, jobb-JSON eller logg. CLI-en
 * (`npm run transfer:encrypt`) skriver omslaget; import kan ta imot det samme
 * formatet når passfrasen sendes separat i multipart-feltet `passphrase`.
 */

export const ENCRYPTION_MAGIC = Buffer.from(
  "FSM-TRANSFER-ENCRYPTED-V1\n",
  "utf8",
);
export const ENCRYPTION_VERSION = 1;
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 1024;

const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_LENGTH_BYTES = 4;
const SCRYPT = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export type EncryptedHeader = {
  format: "fsm-customer-export-encrypted";
  version: typeof ENCRYPTION_VERSION;
  kdf: {
    name: "scrypt";
    N: number;
    r: number;
    p: number;
    salt: string;
  };
  cipher: {
    name: "aes-256-gcm";
    iv: string;
  };
};

export type TransferCryptoErrorCode =
  | "passphrase_required"
  | "passphrase_too_short"
  | "not_encrypted"
  | "encrypted_package_invalid"
  | "decryption_failed";

export class TransferCryptoError extends Error {
  code: TransferCryptoErrorCode;

  constructor(code: TransferCryptoErrorCode) {
    super(code);
    this.name = "TransferCryptoError";
    this.code = code;
  }
}

export function isEncryptedPackage(buffer: Buffer): boolean {
  return (
    buffer.length > ENCRYPTION_MAGIC.length &&
    buffer.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC)
  );
}

function assertPassphrase(passphrase: string | null | undefined): string {
  if (!passphrase) throw new TransferCryptoError("passphrase_required");
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new TransferCryptoError("passphrase_too_short");
  }
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new TransferCryptoError("decryption_failed");
  }
  return passphrase;
}

function deriveKey(passphrase: string, salt: Buffer, params: {
  N: number;
  r: number;
  p: number;
}): Buffer {
  // scrypt krever en eksplisitt maxmem når N er stor. Grensen er romslig for
  // de dokumenterte parameterne, men hindrer en ondsinnet header i å be om
  // vilkårlig mye minne.
  const memory = 128 * params.N * params.r * 2;
  return scryptSync(passphrase, salt, KEY_BYTES, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: Math.max(SCRYPT.maxmem, memory),
  });
}

export function encryptPackageBuffer(
  packageBuffer: Buffer,
  passphrase: string,
): Buffer {
  const secret = assertPassphrase(passphrase);
  if (!Buffer.isBuffer(packageBuffer) || packageBuffer.length === 0) {
    throw new TransferCryptoError("encrypted_package_invalid");
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(secret, salt, SCRYPT);
  const header: EncryptedHeader = {
    format: "fsm-customer-export-encrypted",
    version: ENCRYPTION_VERSION,
    kdf: {
      name: "scrypt",
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      salt: salt.toString("base64"),
    },
    cipher: { name: "aes-256-gcm", iv: iv.toString("base64") },
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.allocUnsafe(HEADER_LENGTH_BYTES);
  length.writeUInt32LE(headerBytes.length, 0);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // AAD binder headeren (KDF-parametre, salt, IV) til ciphertexten.
  cipher.setAAD(Buffer.concat([ENCRYPTION_MAGIC, length, headerBytes]));
  const encrypted = Buffer.concat([
    cipher.update(packageBuffer),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([
    ENCRYPTION_MAGIC,
    length,
    headerBytes,
    encrypted,
    tag,
  ]);
}

function parseHeader(buffer: Buffer): {
  header: EncryptedHeader;
  ciphertext: Buffer;
  tag: Buffer;
} {
  const lengthOffset = ENCRYPTION_MAGIC.length;
  if (buffer.length < lengthOffset + HEADER_LENGTH_BYTES + TAG_BYTES + 1) {
    throw new TransferCryptoError("encrypted_package_invalid");
  }
  const headerLength = buffer.readUInt32LE(lengthOffset);
  if (headerLength <= 0 || headerLength > 4096) {
    throw new TransferCryptoError("encrypted_package_invalid");
  }
  const headerStart = lengthOffset + HEADER_LENGTH_BYTES;
  const headerEnd = headerStart + headerLength;
  if (headerEnd + TAG_BYTES > buffer.length) {
    throw new TransferCryptoError("encrypted_package_invalid");
  }
  let header: EncryptedHeader;
  try {
    header = JSON.parse(
      buffer.subarray(headerStart, headerEnd).toString("utf8"),
    ) as EncryptedHeader;
  } catch {
    throw new TransferCryptoError("encrypted_package_invalid");
  }
  if (
    !header ||
    header.format !== "fsm-customer-export-encrypted" ||
    header.version !== ENCRYPTION_VERSION ||
    header.kdf?.name !== "scrypt" ||
    header.cipher?.name !== "aes-256-gcm"
  ) {
    throw new TransferCryptoError("encrypted_package_invalid");
  }
  // Aksepter bare de dokumenterte KDF-parameterne. En angriper kan ellers be
  // om ekstremt minne/CPU i det omslaget blir dekryptert.
  if (
    header.kdf.N !== SCRYPT.N ||
    header.kdf.r !== SCRYPT.r ||
    header.kdf.p !== SCRYPT.p
  ) {
    throw new TransferCryptoError("encrypted_package_invalid");
  }
  const ciphertext = buffer.subarray(headerEnd, buffer.length - TAG_BYTES);
  const tag = buffer.subarray(buffer.length - TAG_BYTES);
  return { header, ciphertext, tag };
}

export function decryptPackageBuffer(
  envelope: Buffer,
  passphrase: string,
): Buffer {
  if (!isEncryptedPackage(envelope)) {
    throw new TransferCryptoError("not_encrypted");
  }
  const secret = assertPassphrase(passphrase);
  const { header, ciphertext, tag } = parseHeader(envelope);
  const salt = Buffer.from(header.kdf.salt, "base64");
  const iv = Buffer.from(header.cipher.iv, "base64");
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
    throw new TransferCryptoError("encrypted_package_invalid");
  }
  const key = deriveKey(secret, salt, header.kdf);
  const headerStart = ENCRYPTION_MAGIC.length + HEADER_LENGTH_BYTES;
  const headerEnd = headerStart + bufferHeaderLength(envelope);
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(envelope.subarray(0, headerEnd));
  cipher.setAuthTag(tag);
  try {
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]);
  } catch {
    throw new TransferCryptoError("decryption_failed");
  }
}

function bufferHeaderLength(buffer: Buffer): number {
  return buffer.readUInt32LE(ENCRYPTION_MAGIC.length);
}

/** Bare for tester: sammenligner uten å lekke passfrasen. */
export function passphrasesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
