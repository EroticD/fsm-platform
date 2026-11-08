import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ED25519_SIGNATURE_FILE,
  SIGNATURE_FILE,
  createPackageSignatures,
  keyIdFor,
  signPackage,
  signPackageEd25519,
  signatureFileCount,
  signaturePayload,
  transferSigningConfig,
  verifyPackageSignature,
  verifyPackageSignatures,
  type TransferEd25519SigningKey,
  type TransferSigningConfig,
} from "./signature";

const KEY = "k".repeat(64);
const manifest = Buffer.from('{"format":"fsm-customer-export"}\n');
const checksums = Buffer.from("abc  data/customers.json\n");

function ed25519KeyPair(id: string): TransferEd25519SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { id, privateKey, publicKey };
}

function hmacConfig(required = true): TransferSigningConfig {
  return {
    primary: { id: keyIdFor(KEY), key: KEY },
    verificationKeys: [{ id: keyIdFor(KEY), key: KEY }],
    required,
  };
}

function ed25519Config(
  key: TransferEd25519SigningKey,
  required = true,
): TransferSigningConfig {
  return {
    primary: null,
    verificationKeys: [],
    required,
    mode: "ed25519",
    ed25519: {
      primary: key,
      verificationKeys: [{ id: key.id, publicKey: key.publicKey }],
    },
  };
}

describe("pakkesignatur", () => {
  it("signerer og verifiserer manifest + sjekksummer", () => {
    const signature = signPackage(manifest, checksums, {
      key: { id: keyIdFor(KEY), key: KEY },
      signedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(signature).toBeTruthy();
    const result = verifyPackageSignature({
      signatureBytes: signature,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: {
        primary: { id: keyIdFor(KEY), key: KEY },
        verificationKeys: [{ id: keyIdFor(KEY), key: KEY }],
        required: true,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.keyId).toBe(keyIdFor(KEY));
  });

  it("avviser endret manifest, endrede sjekksummer og feil nøkkel", () => {
    const signature = signPackage(manifest, checksums, {
      key: { id: keyIdFor(KEY), key: KEY },
    });
    const config = {
      primary: { id: keyIdFor(KEY), key: KEY },
      verificationKeys: [{ id: keyIdFor(KEY), key: KEY }],
      required: true,
    };

    expect(
      verifyPackageSignature({
        signatureBytes: signature,
        manifestBytes: Buffer.concat([manifest, Buffer.from(" ")]),
        checksumsBytes: checksums,
        config,
      }).errors,
    ).toContain("signature_invalid");

    expect(
      verifyPackageSignature({
        signatureBytes: signature,
        manifestBytes: manifest,
        checksumsBytes: Buffer.concat([checksums, Buffer.from("x")]),
        config,
      }).errors,
    ).toContain("signature_invalid");

    const otherKey = "z".repeat(64);
    expect(
      verifyPackageSignature({
        signatureBytes: signature,
        manifestBytes: manifest,
        checksumsBytes: checksums,
        config: {
          primary: { id: keyIdFor(otherKey), key: otherKey },
          verificationKeys: [{ id: keyIdFor(otherKey), key: otherKey }],
          required: true,
        },
      }).errors,
    ).toContain("signature_invalid");
  });

  it("godtar forrige nøkkel under rotasjon", () => {
    const oldKey = "o".repeat(64);
    const signature = signPackage(manifest, checksums, {
      key: { id: keyIdFor(oldKey), key: oldKey },
    });
    const result = verifyPackageSignature({
      signatureBytes: signature,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: {
        primary: { id: keyIdFor(KEY), key: KEY },
        verificationKeys: [
          { id: keyIdFor(KEY), key: KEY },
          { id: keyIdFor(oldKey), key: oldKey },
        ],
        required: true,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("avviser usignert pakke når signatur er påkrevd", () => {
    const required = verifyPackageSignature({
      signatureBytes: null,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: { primary: null, verificationKeys: [], required: true },
    });
    expect(required.ok).toBe(false);
    expect(required.errors).toContain("signature_missing");

    const optional = verifyPackageSignature({
      signatureBytes: null,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: { primary: null, verificationKeys: [], required: false },
    });
    expect(optional.ok).toBe(true);
    expect(optional.warnings).toContain("signature_unsigned");
  });

  it("leser nøkkel-ID og krevde nøkler fra miljøet uten å lekke nøkkelen", () => {
    const config = transferSigningConfig({
      CUSTOMER_TRANSFER_SIGNING_KEY: KEY,
      CUSTOMER_TRANSFER_SIGNING_KEYS_PREVIOUS: "p".repeat(64),
      CUSTOMER_TRANSFER_REQUIRE_SIGNATURE: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.primary?.key).toBe(KEY);
    expect(config.verificationKeys).toHaveLength(2);
    expect(config.required).toBe(true);
    expect(signaturePayload(manifest, checksums).toString("utf8")).not.toContain(
      KEY,
    );
  });

  it("ignorerer for korte nøkler i stedet for å late som de er trygge", () => {
    const config = transferSigningConfig({
      CUSTOMER_TRANSFER_SIGNING_KEY: "short",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.primary).toBeNull();
  });

  it("signerer og verifiserer med Ed25519", () => {
    const key = ed25519KeyPair("ed-primary");
    const signature = signPackageEd25519(manifest, checksums, {
      key,
      signedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(signature).toBeTruthy();

    const result = verifyPackageSignatures({
      hmacSignatureBytes: null,
      ed25519SignatureBytes: signature,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: ed25519Config(key),
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.algorithms).toEqual(["ed25519"]);
    expect(result.keyId).toBe("ed-primary");
  });

  it("avviser endret manifest og endrede sjekksummer med Ed25519", () => {
    const key = ed25519KeyPair("ed-primary");
    const signature = signPackageEd25519(manifest, checksums, { key });
    const config = ed25519Config(key);

    const manifestTampered = verifyPackageSignatures({
      hmacSignatureBytes: null,
      ed25519SignatureBytes: signature,
      manifestBytes: Buffer.concat([manifest, Buffer.from(" ")]),
      checksumsBytes: checksums,
      config,
    });
    expect(manifestTampered.ok).toBe(false);
    expect(manifestTampered.errors).toContain("signature_invalid");

    const checksumsTampered = verifyPackageSignatures({
      hmacSignatureBytes: null,
      ed25519SignatureBytes: signature,
      manifestBytes: manifest,
      checksumsBytes: Buffer.concat([checksums, Buffer.from("x")]),
      config,
    });
    expect(checksumsTampered.ok).toBe(false);
    expect(checksumsTampered.errors).toContain("signature_invalid");
  });

  it("rapporterer ukjent offentlig nøkkel som untrusted", () => {
    const signer = ed25519KeyPair("ed-signer");
    const other = ed25519KeyPair("ed-other");
    const signature = signPackageEd25519(manifest, checksums, { key: signer });

    const result = verifyPackageSignatures({
      hmacSignatureBytes: null,
      ed25519SignatureBytes: signature,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: ed25519Config(other),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("signature_untrusted");
  });

  it("krever Ed25519-signatur når den er påkrevd", () => {
    const key = ed25519KeyPair("ed-primary");
    const missing = verifyPackageSignatures({
      hmacSignatureBytes: null,
      ed25519SignatureBytes: null,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: ed25519Config(key, true),
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain("signature_missing");

    const optional = verifyPackageSignatures({
      hmacSignatureBytes: null,
      ed25519SignatureBytes: null,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config: ed25519Config(key, false),
    });
    expect(optional.ok).toBe(true);
    expect(optional.warnings).toContain("signature_unsigned");
  });

  it("beholder HMAC-bakoverkompatibilitet når begge algoritmene er konfigurert", () => {
    const edKey = ed25519KeyPair("ed-primary");
    const config: TransferSigningConfig = {
      ...hmacConfig(),
      mode: "any",
      ed25519: {
        primary: edKey,
        verificationKeys: [{ id: edKey.id, publicKey: edKey.publicKey }],
      },
    };
    const hmacSignature = signPackage(manifest, checksums, {
      key: config.primary,
    });

    const result = verifyPackageSignatures({
      hmacSignatureBytes: hmacSignature,
      ed25519SignatureBytes: null,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config,
    });
    expect(result.ok).toBe(true);
    expect(result.algorithms).toEqual(["hmac-sha256"]);
  });

  it("skriver begge signaturfilene når begge nøklene er konfigurert", () => {
    const edKey = ed25519KeyPair("ed-primary");
    const config: TransferSigningConfig = {
      ...hmacConfig(),
      mode: "both",
      ed25519: {
        primary: edKey,
        verificationKeys: [{ id: edKey.id, publicKey: edKey.publicKey }],
      },
    };
    expect(signatureFileCount(config)).toBe(2);
    const signatures = createPackageSignatures(manifest, checksums, {
      config,
      signedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(signatures.files.map((file) => file.path)).toEqual([
      SIGNATURE_FILE,
      ED25519_SIGNATURE_FILE,
    ]);

    const byPath = new Map(
      signatures.files.map((file) => [file.path, file.data]),
    );
    const result = verifyPackageSignatures({
      hmacSignatureBytes: byPath.get(SIGNATURE_FILE) ?? null,
      ed25519SignatureBytes: byPath.get(ED25519_SIGNATURE_FILE) ?? null,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config,
    });
    expect(result.ok).toBe(true);
    expect(result.algorithms.sort()).toEqual(["ed25519", "hmac-sha256"]);
  });

  it("modus «both» avviser en pakke som bare har én av signaturene", () => {
    const edKey = ed25519KeyPair("ed-primary");
    const config: TransferSigningConfig = {
      ...hmacConfig(),
      mode: "both",
      ed25519: {
        primary: edKey,
        verificationKeys: [{ id: edKey.id, publicKey: edKey.publicKey }],
      },
    };
    const onlyHmac = signPackage(manifest, checksums, { key: config.primary });
    const onlyEd = signPackageEd25519(manifest, checksums, { key: edKey });

    for (const [hmacSignatureBytes, ed25519SignatureBytes] of [
      [onlyHmac, null],
      [null, onlyEd],
    ] as const) {
      const result = verifyPackageSignatures({
        hmacSignatureBytes,
        ed25519SignatureBytes,
        manifestBytes: manifest,
        checksumsBytes: checksums,
        config,
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("signature_missing");
    }
  });

  it("ignorerer Ed25519 med advarsel i ren HMAC-modus", () => {
    const edKey = ed25519KeyPair("ed-primary");
    const config: TransferSigningConfig = {
      ...hmacConfig(),
      mode: "hmac",
      ed25519: {
        primary: edKey,
        verificationKeys: [{ id: edKey.id, publicKey: edKey.publicKey }],
      },
    };
    const hmacSignature = signPackage(manifest, checksums, {
      key: config.primary,
    });
    const edSignature = signPackageEd25519(manifest, checksums, { key: edKey });

    const result = verifyPackageSignatures({
      hmacSignatureBytes: hmacSignature,
      ed25519SignatureBytes: edSignature,
      manifestBytes: manifest,
      checksumsBytes: checksums,
      config,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("signature_algorithm_ignored");
  });

  it("leser Ed25519-nøkler fra miljøet med escaped newline og nøkkel-ID", () => {
    const key = ed25519KeyPair("valgfri-etikett");
    const privatePem = key.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");
    const publicPem = key.publicKey
      .export({ type: "spki", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");

    const config = transferSigningConfig({
      CUSTOMER_TRANSFER_ED25519_PRIVATE_KEY: privatePem,
      CUSTOMER_TRANSFER_ED25519_PUBLIC_KEY: publicPem,
      CUSTOMER_TRANSFER_ED25519_KEY_ID: "valgfri-etikett",
      CUSTOMER_TRANSFER_SIGNATURE_MODE: "ed25519",
      CUSTOMER_TRANSFER_REQUIRE_SIGNATURE: "true",
    } as unknown as NodeJS.ProcessEnv);

    expect(config.ed25519?.primary?.id).toBe("valgfri-etikett");
    expect(config.ed25519?.verificationKeys).toHaveLength(1);
    expect(config.mode).toBe("ed25519");
    expect(config.required).toBe(true);
  });
});
