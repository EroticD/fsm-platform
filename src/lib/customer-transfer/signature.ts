// i18n-ignore-file: signaturformat og nøkkel-ID-er er tekniske data.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signatur for kundepakker.
 *
 * Sjekksummene i pakken oppdager korrupsjon, men ikke en ondsinnet endring der
 * både data og manifest er byttet ut. Signaturen binder manifestet og
 * `checksums.sha256` til en hemmelig nøkkel som aldri ligger i pakken.
 *
 * Algoritmen er HMAC-SHA256 med en nøkkel fra miljøet. Formatet er bevisst
 * enkelt og kan verifiseres uten database eller nettverk:
 *
 *   payload = "fsm-customer-export-signature\n1\n<sha256(manifest)>\n<sha256(checksums)>\n"
 *   signature = hex(HMAC-SHA256(key, payload))
 *
 * `manifest.sig` er en liten JSON-fil med nøkkel-ID og digestene. Nøkkel-ID-en
 * er en forkortet SHA-256 av nøkkelen, ikke nøkkelen selv. Ved rotasjon kan
 * målinstallasjonen ha flere verifiseringsnøkler, men bare én aktiv
 * signeringsnøkkel.
 */

export const SIGNATURE_FORMAT = "fsm-customer-export-signature";
export const SIGNATURE_FILE = "manifest.sig";
export const SIGNATURE_VERSION = 1;

export type TransferSignatureRecord = {
  format: typeof SIGNATURE_FORMAT;
  version: typeof SIGNATURE_VERSION;
  algorithm: "hmac-sha256";
  keyId: string;
  signedAt: string;
  manifestSha256: string;
  checksumsSha256: string;
  signature: string;
};

export type TransferSigningKey = {
  id: string;
  key: string;
};

export type TransferSigningConfig = {
  /** Aktiv nøkkel for nye pakker. */
  primary: TransferSigningKey | null;
  /** Alle nøkler som godtas ved import (aktiv + tidligere). */
  verificationKeys: TransferSigningKey[];
  /** Når sann avvises usignerte pakker. */
  required: boolean;
};

export function keyIdFor(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Leser signeringskonfigurasjonen. Nøkkelen må være minst 32 tegn; kortere
 * nøkler ignoreres med vilje, slik at en tom/feilkonfigurert variabel ikke
 * gir en falsk trygghet.
 */
export function transferSigningConfig(
  env: NodeJS.ProcessEnv = process.env,
): TransferSigningConfig {
  const primaryKey = env.CUSTOMER_TRANSFER_SIGNING_KEY?.trim() ?? "";
  const primary =
    primaryKey.length >= 32
      ? {
          key: primaryKey,
          id:
            env.CUSTOMER_TRANSFER_SIGNING_KEY_ID?.trim().slice(0, 64) ||
            keyIdFor(primaryKey),
        }
      : null;

  const previous = (env.CUSTOMER_TRANSFER_SIGNING_KEYS_PREVIOUS ?? "")
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter((key) => key.length >= 32)
    .map((key) => ({ key, id: keyIdFor(key) }));

  const verificationKeys = primary ? [primary, ...previous] : previous;
  return {
    primary,
    verificationKeys,
    required: parseBoolean(env.CUSTOMER_TRANSFER_REQUIRE_SIGNATURE),
  };
}

export function signaturePayload(
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
): Buffer {
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const checksumsSha256 = createHash("sha256")
    .update(checksumsBytes)
    .digest("hex");
  return Buffer.from(
    `${SIGNATURE_FORMAT}\n${SIGNATURE_VERSION}\n${manifestSha256}\n${checksumsSha256}\n`,
    "utf8",
  );
}

function digest(manifestBytes: Buffer, checksumsBytes: Buffer): {
  manifestSha256: string;
  checksumsSha256: string;
} {
  return {
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    checksumsSha256: createHash("sha256")
      .update(checksumsBytes)
      .digest("hex"),
  };
}

export function signPackage(
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
  options: {
    key?: TransferSigningKey | null;
    signedAt?: Date;
  } = {},
): Buffer | null {
  const config = transferSigningConfig();
  const key = options.key ?? config.primary;
  if (!key) return null;

  const hashes = digest(manifestBytes, checksumsBytes);
  const signature = createHmac("sha256", key.key)
    .update(signaturePayload(manifestBytes, checksumsBytes))
    .digest("hex");
  const record: TransferSignatureRecord = {
    format: SIGNATURE_FORMAT,
    version: SIGNATURE_VERSION,
    algorithm: "hmac-sha256",
    keyId: key.id,
    signedAt: (options.signedAt ?? new Date()).toISOString(),
    manifestSha256: hashes.manifestSha256,
    checksumsSha256: hashes.checksumsSha256,
    signature,
  };
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export type SignatureVerification = {
  ok: boolean;
  /** Stabile koder, ikke fritekst. */
  errors: Array<"signature_invalid" | "signature_missing">;
  warnings: Array<"signature_key_missing" | "signature_unsigned">;
  keyId: string | null;
};

function parseRecord(raw: Buffer): TransferSignatureRecord | null {
  try {
    const value = JSON.parse(raw.toString("utf8")) as Partial<TransferSignatureRecord>;
    if (
      value.format !== SIGNATURE_FORMAT ||
      value.version !== SIGNATURE_VERSION ||
      value.algorithm !== "hmac-sha256" ||
      typeof value.keyId !== "string" ||
      typeof value.signature !== "string" ||
      !/^[a-f0-9]{64}$/i.test(value.signature) ||
      typeof value.manifestSha256 !== "string" ||
      typeof value.checksumsSha256 !== "string"
    ) {
      return null;
    }
    return value as TransferSignatureRecord;
  } catch {
    return null;
  }
}

/**
 * Verifiserer `manifest.sig` mot de faktiske manifest- og sjekksumbytende.
 * Returnerer stabile koder; kalleren oversetter til `TransferIssue`.
 */
export function verifyPackageSignature(input: {
  signatureBytes: Buffer | null;
  manifestBytes: Buffer;
  checksumsBytes: Buffer;
  config?: TransferSigningConfig;
}): SignatureVerification {
  const config = input.config ?? transferSigningConfig();
  const errors: SignatureVerification["errors"] = [];
  const warnings: SignatureVerification["warnings"] = [];

  if (!input.signatureBytes) {
    if (config.required) errors.push("signature_missing");
    else warnings.push("signature_unsigned");
    return { ok: errors.length === 0, errors, warnings, keyId: null };
  }

  if (config.verificationKeys.length === 0) {
    // En signert pakke kan ikke verifiseres uten nøkkel. I ikke-påkrevd modus
    // er dette en advarsel, slik at en mottaker kan velge å avvise manuelt.
    if (config.required) errors.push("signature_missing");
    else warnings.push("signature_key_missing");
    return { ok: errors.length === 0, errors, warnings, keyId: null };
  }

  const record = parseRecord(input.signatureBytes);
  if (!record) {
    errors.push("signature_invalid");
    return { ok: false, errors, warnings, keyId: null };
  }

  const hashes = digest(input.manifestBytes, input.checksumsBytes);
  if (
    record.manifestSha256 !== hashes.manifestSha256 ||
    record.checksumsSha256 !== hashes.checksumsSha256
  ) {
    errors.push("signature_invalid");
    return { ok: false, errors, warnings, keyId: record.keyId };
  }

  const payload = signaturePayload(input.manifestBytes, input.checksumsBytes);
  const expected = Buffer.from(record.signature, "hex");
  let matched = false;
  for (const candidate of config.verificationKeys) {
    const actual = Buffer.from(
      createHmac("sha256", candidate.key).update(payload).digest("hex"),
      "hex",
    );
    if (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    ) {
      matched = true;
      break;
    }
  }
  if (!matched) errors.push("signature_invalid");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    keyId: record.keyId,
  };
}
