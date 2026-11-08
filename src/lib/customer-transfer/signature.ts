// i18n-ignore-file: signaturformat og nøkkel-ID-er er tekniske data.
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * Signatur for kundepakker.
 *
 * Sjekksummene i pakken oppdager korrupsjon, men ikke en ondsinnet endring der
 * både data og manifest er byttet ut. Signaturen binder manifestet og
 * `checksums.sha256` til en hemmelighet som aldri ligger i pakken.
 *
 * To algoritmer støttes:
 *
 * 1. HMAC-SHA256 med en delt hemmelighet (`manifest.sig`). Bakoverkompatibel
 *    med alle pakker laget før Ed25519-støtten.
 * 2. Ed25519 med et asymmetrisk nøkkelpar (`manifest.sig.ed25519`). Mottakeren
 *    trenger bare den offentlige nøkkelen for å verifisere.
 *
 * Begge signerer nøyaktig samme kanoniske materiale:
 *
 *   payload = "fsm-customer-export-signature\n1\n<sha256(manifest)>\n<sha256(checksums)>\n"
 *
 * Filene er små JSON-records med nøkkel-ID og digestene. Nøkkel-ID-en er en
 * forkortet SHA-256 av nøkkelen, ikke nøkkelen selv. Ved rotasjon kan
 * målinstallasjonen ha flere verifiseringsnøkler, men bare én aktiv
 * signeringsnøkkel per algoritme.
 *
 * Modus (`CUSTOMER_TRANSFER_SIGNATURE_MODE`) styrer hvilke signaturer som
 * skrives og godtas:
 *
 * - `hmac`: bare HMAC. Ed25519 ignoreres med en advarsel.
 * - `ed25519`: bare Ed25519. HMAC ignoreres med en advarsel.
 * - `both`: begge må finnes og være gyldige.
 * - `any`: minst én gyldig av de konfigurerte algoritmene. Standard når både
 *   HMAC og Ed25519 er konfigurert, slik at gamle HMAC-pakker fortsatt virker.
 *
 * En signatur som er til stede, men ugyldig, avvises alltid. `any` er altså
 * ikke «ignorer feil signatur», bare «krev ikke begge».
 */

export const SIGNATURE_FORMAT = "fsm-customer-export-signature";
export const SIGNATURE_FILE = "manifest.sig";
export const ED25519_SIGNATURE_FILE = "manifest.sig.ed25519";
export const SIGNATURE_VERSION = 1;

export type TransferSignatureMode = "hmac" | "ed25519" | "both" | "any";

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

export type TransferEd25519SignatureRecord = {
  format: typeof SIGNATURE_FORMAT;
  version: typeof SIGNATURE_VERSION;
  algorithm: "ed25519";
  keyId: string;
  signedAt: string;
  manifestSha256: string;
  checksumsSha256: string;
  /** base64 av den rå 64-byte Ed25519-signaturen. */
  signature: string;
};

export type TransferSigningKey = {
  id: string;
  key: string;
};

export type TransferEd25519VerificationKey = {
  id: string;
  publicKey: KeyObject;
};

export type TransferEd25519SigningKey = {
  id: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
};

export type TransferEd25519Config = {
  /** Aktiv nøkkel for nye pakker. Bare privatnøkkelen trengs for eksport. */
  primary: TransferEd25519SigningKey | null;
  /** Alle offentlige nøkler som godtas ved import (aktiv + tidligere). */
  verificationKeys: TransferEd25519VerificationKey[];
};

export type TransferSigningConfig = {
  /** Aktiv HMAC-nøkkel for nye pakker. */
  primary: TransferSigningKey | null;
  /** Alle HMAC-nøkler som godtas ved import (aktiv + tidligere). */
  verificationKeys: TransferSigningKey[];
  /** Når sann avvises pakker uten gyldig signatur. */
  required: boolean;
  /** Utelatt i eldre tester/kall; utledes da fra konfigurerte nøkler. */
  mode?: TransferSignatureMode;
  /** Ed25519-nøkler. Utelatt betyr «ikke konfigurert». */
  ed25519?: TransferEd25519Config;
};

export function keyIdFor(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function keyIdForPublicKey(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseMode(value: string | undefined): TransferSignatureMode | null {
  const mode = value?.trim().toLowerCase();
  return mode === "hmac" ||
    mode === "ed25519" ||
    mode === "both" ||
    mode === "any"
    ? mode
    : null;
}

/** Miljøvariabler kan inneholde PEM med escaped newline (`\n`). */
function unescapePem(value: string | undefined): string {
  return (value ?? "").trim().replace(/\\n/g, "\n");
}

function readPrivateKey(
  value: string | undefined,
): { privateKey: KeyObject; publicKey: KeyObject } | null {
  const pem = unescapePem(value);
  if (!pem) return null;
  try {
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") return null;
    return { privateKey, publicKey: createPublicKey(privateKey) };
  } catch {
    return null;
  }
}

function readPublicKey(value: string): KeyObject | null {
  const pem = unescapePem(value);
  if (!pem) return null;
  try {
    const publicKey = createPublicKey(pem);
    return publicKey.asymmetricKeyType === "ed25519" ? publicKey : null;
  } catch {
    return null;
  }
}

type PublicKeyInput = { id?: string; pem: string };

/**
 * Leser en eller flere offentlige nøkler. Formatet er en JSON-array med
 * PEM-strenger eller `{ id, publicKey }`, eller en kommaseparert liste med PEM.
 * PEM har ikke komma, så kommaseparering er entydig.
 */
function parsePublicKeyInputs(value: string | undefined): PublicKeyInput[] {
  const raw = value?.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item): PublicKeyInput[] => {
        if (typeof item === "string") return [{ pem: item }];
        if (item && typeof item === "object") {
          const record = item as { id?: unknown; publicKey?: unknown; key?: unknown };
          const pem =
            typeof record.publicKey === "string"
              ? record.publicKey
              : typeof record.key === "string"
                ? record.key
                : null;
          if (!pem) return [];
          return [
            {
              pem,
              ...(typeof record.id === "string" && record.id.trim()
                ? { id: record.id.trim().slice(0, 64) }
                : {}),
            },
          ];
        }
        return [];
      });
    } catch {
      return [];
    }
  }
  return raw
    .split(",")
    .map((pem) => pem.trim())
    .filter(Boolean)
    .map((pem) => ({ pem }));
}

/**
 * Leser signeringskonfigurasjonen. En HMAC-nøkkel må være minst 32 tegn;
 * kortere nøkler ignoreres med vilje, slik at en tom/feilkonfigurert variabel
 * ikke gir en falsk trygghet. Ugyldige Ed25519-nøkler ignoreres på samme måte.
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

  const ed25519Private = readPrivateKey(
    env.CUSTOMER_TRANSFER_ED25519_PRIVATE_KEY,
  );
  const ed25519Id =
    env.CUSTOMER_TRANSFER_ED25519_KEY_ID?.trim().slice(0, 64) ||
    (ed25519Private ? keyIdForPublicKey(ed25519Private.publicKey) : "");

  const configuredPublicKeys = parsePublicKeyInputs(
    env.CUSTOMER_TRANSFER_ED25519_PUBLIC_KEY,
  );
  const configuredPrevious = parsePublicKeyInputs(
    env.CUSTOMER_TRANSFER_ED25519_PUBLIC_KEYS_PREVIOUS,
  );

  const edVerificationKeys: TransferEd25519VerificationKey[] = [];
  const seenPublicKeys = new Set<string>();
  const addPublic = (input: PublicKeyInput) => {
    const publicKey = readPublicKey(input.pem);
    if (!publicKey) return;
    const der = publicKey.export({ type: "spki", format: "der" }).toString("hex");
    if (seenPublicKeys.has(der)) return;
    seenPublicKeys.add(der);
    edVerificationKeys.push({
      id: input.id || keyIdForPublicKey(publicKey),
      publicKey,
    });
  };

  for (const input of configuredPublicKeys) addPublic(input);
  for (const input of configuredPrevious) addPublic(input);
  // På en installasjon som både signerer og verifiserer, trenger ikke operatøren
  // å duplisere den offentlige nøkkelen i en egen variabel.
  if (edVerificationKeys.length === 0 && ed25519Private) {
    addPublic({
      id: ed25519Id || undefined,
      pem: ed25519Private.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    });
  }

  const ed25519: TransferEd25519Config = {
    primary: ed25519Private
      ? {
          id: ed25519Id,
          privateKey: ed25519Private.privateKey,
          publicKey: ed25519Private.publicKey,
        }
      : null,
    verificationKeys: edVerificationKeys,
  };

  const explicitMode = parseMode(env.CUSTOMER_TRANSFER_SIGNATURE_MODE);
  const hasHmac = primary !== null;
  const hasEd25519 = ed25519.primary !== null || edVerificationKeys.length > 0;
  // Standard: godta begge når begge er konfigurert. Det bevarer gamle
  // HMAC-pakker samtidig som nye pakker også kan signeres med Ed25519.
  const mode: TransferSignatureMode =
    explicitMode ??
    (hasHmac && hasEd25519
      ? "any"
      : hasEd25519
        ? "ed25519"
        : "hmac");

  return {
    primary,
    verificationKeys,
    required: parseBoolean(env.CUSTOMER_TRANSFER_REQUIRE_SIGNATURE),
    mode,
    ed25519,
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

function hmacRecord(
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
  key: TransferSigningKey,
  signedAt: Date,
): Buffer {
  const hashes = digest(manifestBytes, checksumsBytes);
  const signature = createHmac("sha256", key.key)
    .update(signaturePayload(manifestBytes, checksumsBytes))
    .digest("hex");
  const record: TransferSignatureRecord = {
    format: SIGNATURE_FORMAT,
    version: SIGNATURE_VERSION,
    algorithm: "hmac-sha256",
    keyId: key.id,
    signedAt: signedAt.toISOString(),
    manifestSha256: hashes.manifestSha256,
    checksumsSha256: hashes.checksumsSha256,
    signature,
  };
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function ed25519Record(
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
  key: TransferEd25519SigningKey,
  signedAt: Date,
): Buffer {
  const hashes = digest(manifestBytes, checksumsBytes);
  const signature = sign(
    null,
    signaturePayload(manifestBytes, checksumsBytes),
    key.privateKey,
  ).toString("base64");
  const record: TransferEd25519SignatureRecord = {
    format: SIGNATURE_FORMAT,
    version: SIGNATURE_VERSION,
    algorithm: "ed25519",
    keyId: key.id,
    signedAt: signedAt.toISOString(),
    manifestSha256: hashes.manifestSha256,
    checksumsSha256: hashes.checksumsSha256,
    signature,
  };
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/** Bakoverkompatibel HMAC-signering. */
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
  return hmacRecord(
    manifestBytes,
    checksumsBytes,
    key,
    options.signedAt ?? new Date(),
  );
}

export function signPackageEd25519(
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
  options: {
    key?: TransferEd25519SigningKey | null;
    signedAt?: Date;
    config?: TransferSigningConfig;
  } = {},
): Buffer | null {
  const config = options.config ?? transferSigningConfig();
  const key = options.key ?? config.ed25519?.primary ?? null;
  if (!key) return null;
  return ed25519Record(
    manifestBytes,
    checksumsBytes,
    key,
    options.signedAt ?? new Date(),
  );
}

export function signatureMode(config: TransferSigningConfig): TransferSignatureMode {
  if (config.mode) return config.mode;
  const hasHmac = config.primary !== null || config.verificationKeys.length > 0;
  const hasEd25519 =
    Boolean(config.ed25519?.primary) ||
    (config.ed25519?.verificationKeys.length ?? 0) > 0;
  if (hasHmac && hasEd25519) return "any";
  return hasEd25519 ? "ed25519" : "hmac";
}

export function signatureFileCount(config: TransferSigningConfig): number {
  const mode = signatureMode(config);
  return (
    (mode !== "ed25519" && config.primary ? 1 : 0) +
    (mode !== "hmac" && config.ed25519?.primary ? 1 : 0)
  );
}

export type PackageSignatureFile = {
  path: typeof SIGNATURE_FILE | typeof ED25519_SIGNATURE_FILE;
  data: Buffer;
};

/**
 * Lager alle signaturfilene eksporten skal skrive. Konfigurasjonen leses én
 * gang, slik at eksporten og manifestets `totals.entries` alltid er enige.
 */
export function createPackageSignatures(
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
  options: {
    config?: TransferSigningConfig;
    signedAt?: Date;
  } = {},
): { files: PackageSignatureFile[]; mode: TransferSignatureMode } {
  const config = options.config ?? transferSigningConfig();
  const mode = signatureMode(config);
  const signedAt = options.signedAt ?? new Date();
  const files: PackageSignatureFile[] = [];
  if (mode !== "ed25519" && config.primary) {
    files.push({
      path: SIGNATURE_FILE,
      data: hmacRecord(manifestBytes, checksumsBytes, config.primary, signedAt),
    });
  }
  if (mode !== "hmac" && config.ed25519?.primary) {
    files.push({
      path: ED25519_SIGNATURE_FILE,
      data: ed25519Record(
        manifestBytes,
        checksumsBytes,
        config.ed25519.primary,
        signedAt,
      ),
    });
  }
  return { files, mode };
}

export type SignatureErrorCode =
  | "signature_invalid"
  | "signature_missing"
  | "signature_untrusted";

export type SignatureWarningCode =
  | "signature_key_missing"
  | "signature_unsigned"
  | "signature_algorithm_ignored";

export type SignatureVerification = {
  ok: boolean;
  /** Stabile koder, ikke fritekst. */
  errors: SignatureErrorCode[];
  warnings: SignatureWarningCode[];
  keyId: string | null;
  /** Algoritmer som faktisk ble godkjent. */
  algorithms: Array<"hmac-sha256" | "ed25519">;
};

function parseHmacRecord(raw: Buffer): TransferSignatureRecord | null {
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

function parseEd25519Record(
  raw: Buffer,
): TransferEd25519SignatureRecord | null {
  try {
    const value = JSON.parse(
      raw.toString("utf8"),
    ) as Partial<TransferEd25519SignatureRecord>;
    if (
      value.format !== SIGNATURE_FORMAT ||
      value.version !== SIGNATURE_VERSION ||
      value.algorithm !== "ed25519" ||
      typeof value.keyId !== "string" ||
      typeof value.signature !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature) ||
      typeof value.manifestSha256 !== "string" ||
      typeof value.checksumsSha256 !== "string"
    ) {
      return null;
    }
    return value as TransferEd25519SignatureRecord;
  } catch {
    return null;
  }
}

type RecordVerification = {
  ok: boolean;
  code?: "signature_invalid" | "signature_untrusted" | "signature_key_missing";
};

function verifyHmacRecord(
  record: TransferSignatureRecord,
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
  config: TransferSigningConfig,
): RecordVerification {
  if (config.verificationKeys.length === 0) {
    return { ok: false, code: "signature_key_missing" };
  }
  const hashes = digest(manifestBytes, checksumsBytes);
  if (
    record.manifestSha256 !== hashes.manifestSha256 ||
    record.checksumsSha256 !== hashes.checksumsSha256
  ) {
    return { ok: false, code: "signature_invalid" };
  }
  const payload = signaturePayload(manifestBytes, checksumsBytes);
  const expected = Buffer.from(record.signature, "hex");
  for (const candidate of config.verificationKeys) {
    const actual = Buffer.from(
      createHmac("sha256", candidate.key).update(payload).digest("hex"),
      "hex",
    );
    if (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    ) {
      return { ok: true };
    }
  }
  // Feil HMAC-nøkkel er en ugyldig signatur, ikke en manglende tillitsanker.
  // Vi beholder den etablerte koden for bakoverkompatibilitet.
  return { ok: false, code: "signature_invalid" };
}

function verifyEd25519Record(
  record: TransferEd25519SignatureRecord,
  manifestBytes: Buffer,
  checksumsBytes: Buffer,
  config: TransferSigningConfig,
): RecordVerification {
  const keys = config.ed25519?.verificationKeys ?? [];
  if (keys.length === 0) {
    return { ok: false, code: "signature_key_missing" };
  }
  const hashes = digest(manifestBytes, checksumsBytes);
  if (
    record.manifestSha256 !== hashes.manifestSha256 ||
    record.checksumsSha256 !== hashes.checksumsSha256
  ) {
    return { ok: false, code: "signature_invalid" };
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(record.signature, "base64");
  } catch {
    return { ok: false, code: "signature_invalid" };
  }
  if (signature.length !== 64) return { ok: false, code: "signature_invalid" };
  const payload = signaturePayload(manifestBytes, checksumsBytes);
  for (const candidate of keys) {
    try {
      if (verify(null, payload, candidate.publicKey, signature)) {
        return { ok: true };
      }
    } catch {
      // En ugyldig nøkkel skal ikke kaste ut verifiseringen.
    }
  }
  // Ingen konfigurert offentlig nøkkel passer. Hvis keyId-en finnes blant de
  // betrodde nøklene, er pakken endret; ellers er den signert med en ukjent
  // nøkkel (feil nøkkel eller rotasjon som mangler den gamle offentlige).
  const knownKeyId = keys.some((candidate) => candidate.id === record.keyId);
  return { ok: false, code: knownKeyId ? "signature_invalid" : "signature_untrusted" };
}

export type VerifyPackageSignaturesInput = {
  hmacSignatureBytes: Buffer | null;
  ed25519SignatureBytes: Buffer | null;
  manifestBytes: Buffer;
  checksumsBytes: Buffer;
  config?: TransferSigningConfig;
};

/**
 * Verifiserer alle signaturer før kalleren stoler på manifest/checksums.
 * Returnerer stabile koder; `read-package.ts` oversetter til `TransferIssue`.
 */
export function verifyPackageSignatures(
  input: VerifyPackageSignaturesInput,
): SignatureVerification {
  const config = input.config ?? transferSigningConfig();
  const mode = signatureMode(config);
  const errors = new Set<SignatureErrorCode>();
  const warnings = new Set<SignatureWarningCode>();
  const algorithms: SignatureVerification["algorithms"] = [];
  const keyIds: string[] = [];

  const hmacPresent = Boolean(input.hmacSignatureBytes);
  const edPresent = Boolean(input.ed25519SignatureBytes);

  // Algoritmer som er slått av i denne modusen ignoreres bevisst, men med en
  // advarsel, slik at en HMAC-only mottaker kan se at pakken også er signert
  // asymmetrisk.
  if (hmacPresent && mode === "ed25519") {
    warnings.add("signature_algorithm_ignored");
  }
  if (edPresent && mode === "hmac") {
    warnings.add("signature_algorithm_ignored");
  }

  if (hmacPresent && mode !== "ed25519") {
    const record = parseHmacRecord(input.hmacSignatureBytes as Buffer);
    if (!record) {
      errors.add("signature_invalid");
    } else {
      keyIds.push(record.keyId);
      const result = verifyHmacRecord(
        record,
        input.manifestBytes,
        input.checksumsBytes,
        config,
      );
      if (result.ok) algorithms.push("hmac-sha256");
      else if (result.code === "signature_key_missing") {
        if (config.required) errors.add("signature_missing");
        else warnings.add("signature_key_missing");
      } else if (result.code === "signature_untrusted") {
        errors.add("signature_untrusted");
      } else errors.add("signature_invalid");
    }
  }

  if (edPresent && mode !== "hmac") {
    const record = parseEd25519Record(input.ed25519SignatureBytes as Buffer);
    if (!record) {
      errors.add("signature_invalid");
    } else {
      keyIds.push(record.keyId);
      const result = verifyEd25519Record(
        record,
        input.manifestBytes,
        input.checksumsBytes,
        config,
      );
      if (result.ok) algorithms.push("ed25519");
      else if (result.code === "signature_key_missing") {
        if (config.required) errors.add("signature_missing");
        else warnings.add("signature_key_missing");
      } else if (result.code === "signature_untrusted") {
        errors.add("signature_untrusted");
      } else errors.add("signature_invalid");
    }
  }

  const acceptedPresent =
    (hmacPresent && mode !== "ed25519") ||
    (edPresent && mode !== "hmac");

  if (mode === "both") {
    const hmacOk = algorithms.includes("hmac-sha256");
    const edOk = algorithms.includes("ed25519");
    if (!hmacOk || !edOk) {
      if (config.required || hmacPresent || edPresent) {
        errors.add("signature_missing");
      } else {
        warnings.add("signature_unsigned");
      }
    }
  } else if (!acceptedPresent) {
    if (config.required) errors.add("signature_missing");
    else warnings.add("signature_unsigned");
  } else if (
    (mode === "hmac" && !algorithms.includes("hmac-sha256")) ||
    (mode === "ed25519" && !algorithms.includes("ed25519"))
  ) {
    // Signaturfilen fantes, men var ugyldig/utroverdig. Feilen er allerede lagt
    // til over; ikke skjul den med en advarsel. En signert pakke uten
    // verifiseringsnøkkel gir `signature_key_missing`, ikke «usignert».
    if (errors.size === 0 && !warnings.has("signature_key_missing")) {
      if (config.required) errors.add("signature_missing");
      else warnings.add("signature_unsigned");
    }
  }

  if (config.required && algorithms.length === 0 && errors.size === 0) {
    errors.add("signature_missing");
  }

  return {
    ok: errors.size === 0,
    errors: [...errors],
    warnings: [...warnings],
    keyId: keyIds[0] ?? null,
    algorithms,
  };
}

/**
 * Bakoverkompatibel verifisering av `manifest.sig` (HMAC). Nye kall bør bruke
 * `verifyPackageSignatures`, som også håndterer `manifest.sig.ed25519`.
 */
export function verifyPackageSignature(input: {
  signatureBytes: Buffer | null;
  manifestBytes: Buffer;
  checksumsBytes: Buffer;
  config?: TransferSigningConfig;
}): SignatureVerification {
  return verifyPackageSignatures({
    hmacSignatureBytes: input.signatureBytes,
    ed25519SignatureBytes: null,
    manifestBytes: input.manifestBytes,
    checksumsBytes: input.checksumsBytes,
    config: input.config,
  });
}
