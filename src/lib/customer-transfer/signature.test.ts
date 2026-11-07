import { describe, expect, it } from "vitest";
import {
  keyIdFor,
  signPackage,
  signaturePayload,
  transferSigningConfig,
  verifyPackageSignature,
} from "./signature";

const KEY = "k".repeat(64);
const manifest = Buffer.from('{"format":"fsm-customer-export"}\n');
const checksums = Buffer.from("abc  data/customers.json\n");

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
});
