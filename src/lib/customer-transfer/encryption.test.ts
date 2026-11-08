import { describe, expect, it } from "vitest";
import {
  MIN_PASSPHRASE_LENGTH,
  TransferCryptoError,
  decryptPackageBuffer,
  encryptPackageBuffer,
  isEncryptedPackage,
} from "./encryption";

const PASSPHRASE = "korrekt hest batteri stiftemaskin";
const PACKAGE = Buffer.from("PK\u0003\u0004this-is-a-fake-but-roundtrippable-zip");

describe("kryptert pakkeomslag", () => {
  it("krypterer og dekrypterer byte-identisk", () => {
    const envelope = encryptPackageBuffer(PACKAGE, PASSPHRASE);
    expect(isEncryptedPackage(envelope)).toBe(true);
    expect(envelope.includes(PACKAGE)).toBe(false);
    expect(decryptPackageBuffer(envelope, PASSPHRASE)).toEqual(PACKAGE);
  });

  it("bruker nytt salt og IV for hver kryptering", () => {
    const first = encryptPackageBuffer(PACKAGE, PASSPHRASE);
    const second = encryptPackageBuffer(PACKAGE, PASSPHRASE);
    expect(first.equals(second)).toBe(false);
  });

  it("avviser feil passfrase uten å returnere klartekst", () => {
    const envelope = encryptPackageBuffer(PACKAGE, PASSPHRASE);
    expect(() =>
      decryptPackageBuffer(envelope, "feil passfrase som er lang nok"),
    ).toThrow(TransferCryptoError);
  });

  it("avviser endret ciphertext, tag og header", () => {
    const envelope = encryptPackageBuffer(PACKAGE, PASSPHRASE);

    const ciphertextTampered = Buffer.from(envelope);
    ciphertextTampered[ciphertextTampered.length - 20] ^= 0xff;
    expect(() =>
      decryptPackageBuffer(ciphertextTampered, PASSPHRASE),
    ).toThrow(TransferCryptoError);

    const tagTampered = Buffer.from(envelope);
    tagTampered[tagTampered.length - 1] ^= 0xff;
    expect(() => decryptPackageBuffer(tagTampered, PASSPHRASE)).toThrow(
      TransferCryptoError,
    );

    const headerTampered = Buffer.from(envelope);
    const headerStart = "FSM-TRANSFER-ENCRYPTED-V1\n".length + 4;
    headerTampered[headerStart + 2] ^= 0x01;
    expect(() => decryptPackageBuffer(headerTampered, PASSPHRASE)).toThrow(
      TransferCryptoError,
    );
  });

  it("krever en lang nok passfrase", () => {
    expect(() =>
      encryptPackageBuffer(PACKAGE, "kort"),
    ).toThrow(TransferCryptoError);
    expect(MIN_PASSPHRASE_LENGTH).toBeGreaterThanOrEqual(12);
  });

  it("avviser vilkårlige KDF-parametere i headeren", () => {
    const envelope = encryptPackageBuffer(PACKAGE, PASSPHRASE);
    const lengthOffset = "FSM-TRANSFER-ENCRYPTED-V1\n".length;
    const headerLength = envelope.readUInt32LE(lengthOffset);
    const headerStart = lengthOffset + 4;
    const header = JSON.parse(
      envelope
        .subarray(headerStart, headerStart + headerLength)
        .toString("utf8"),
    ) as { kdf: { N: number } };
    header.kdf.N = 2 ** 20;
    const changed = Buffer.from(JSON.stringify(header), "utf8");
    const tampered = Buffer.concat([
      envelope.subarray(0, headerStart),
      changed,
      envelope.subarray(headerStart + headerLength),
    ]);
    expect(() => decryptPackageBuffer(tampered, PASSPHRASE)).toThrow(
      TransferCryptoError,
    );
  });
});
