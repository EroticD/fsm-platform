import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeOfflinePin,
  createOfflineKey,
  decryptOfflinePayload,
  encryptOfflinePayload,
  hasOfflineKey,
  isOfflineUnlocked,
  lockAllOfflineSessions,
  lockOfflineSession,
  MAX_PIN_ATTEMPTS,
  OFFLINE_ENCRYPTION_VERSION,
  OFFLINE_IDLE_LOCK_MS,
  OfflineLockedError,
  OfflinePinError,
  OfflineTamperError,
  offlineKeyStorageKey,
  PBKDF2_ITERATIONS,
  PIN_LOCKOUT_MS,
  unlockOfflineKey,
} from "./crypto";

function installLocalStorage() {
  const values = new Map<string, string>();
  const fake = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  vi.stubGlobal("localStorage", fake);
  return fake;
}

const TEST_ITERATIONS = 1_000;
const PIN = "123456";

const sensitiveDraft = JSON.stringify({
  notes: "Kunde Ola Nordmann, Storgata 1, 0182 Oslo",
  images: ["https://example.test/uploads/signatur.png"],
  signature: "data:image/png;base64,c2lnbmF0dXJl",
  units: [{ id: "unit-1", serial: "SN-123", status: "GODKJENT" }],
});

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
  lockAllOfflineSessions();
  vi.unstubAllGlobals();
  storage = installLocalStorage();
});

describe("offline-kryptering – rundtur", () => {
  it("bruker en arbeidsfaktor som gjør offline gjetting kostbart", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("krypterer og dekrypterer hele kladden uten tap", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });

    const sealed = await encryptOfflinePayload(
      "u1",
      "draft:u1:wo1:tpl1",
      sensitiveDraft,
    );

    expect(sealed.enc).toBe(OFFLINE_ENCRYPTION_VERSION);
    expect(sealed.payload).not.toContain("Ola Nordmann");
    expect(sealed.payload).not.toContain("Storgata");
    await expect(
      decryptOfflinePayload("u1", "draft:u1:wo1:tpl1", sealed),
    ).resolves.toBe(sensitiveDraft);
  });

  it("lagrer bare en PIN-innpakket nøkkel, aldri rå nøkkel eller PIN", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });

    expect(hasOfflineKey("u1")).toBe(true);
    const raw = storage.getItem(offlineKeyStorageKey("u1")) ?? "";
    const record = JSON.parse(raw) as Record<string, unknown>;

    expect(record.wrappedKey).toEqual(expect.any(String));
    expect(record.wrapIv).toEqual(expect.any(String));
    expect(record.salt).toEqual(expect.any(String));
    expect(record.rawKey).toBeUndefined();
    expect(raw).not.toContain(PIN);
  });
});

describe("offline-kryptering – feil PIN og låsing", () => {
  it("avviser feil PIN, låser etter grensen og slipper inn etter låseperioden", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });
    lockOfflineSession("u1");
    const now = 1_800_000_000_000;

    for (let attempt = 1; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      await expect(unlockOfflineKey("u1", "000000", now)).rejects.toMatchObject(
        {
          name: "OfflinePinError",
          code: "wrong-pin",
          remainingAttempts: MAX_PIN_ATTEMPTS - attempt,
        },
      );
    }

    await expect(
      unlockOfflineKey("u1", "000000", now),
    ).rejects.toMatchObject({
      name: "OfflinePinError",
      code: "locked",
      remainingAttempts: 0,
    });

    // Riktig PIN avvises også mens låsen varer.
    await expect(unlockOfflineKey("u1", PIN, now)).rejects.toMatchObject({
      code: "locked",
    });

    await expect(
      unlockOfflineKey("u1", PIN, now + PIN_LOCKOUT_MS + 1),
    ).resolves.toBeUndefined();
    expect(isOfflineUnlocked("u1", now + PIN_LOCKOUT_MS + 2)).toBe(true);
  });

  it("låser nøkkelen etter inaktivitet og krever PIN på nytt", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });
    const createdAt = Date.now();
    const sealed = await encryptOfflinePayload("u1", "draft:a", "hemmelig");

    expect(isOfflineUnlocked("u1", createdAt)).toBe(true);
    // Krypteringen oppdaterer lastUsedAt etter at createdAt ble tatt. Legg
    // derfor god margin på, ellers er testen avhengig av hvor lang tid
    // krypteringen tar på maskinen som kjører den.
    expect(
      isOfflineUnlocked("u1", createdAt + OFFLINE_IDLE_LOCK_MS + 60_000),
    ).toBe(false);
    await expect(
      decryptOfflinePayload("u1", "draft:a", sealed),
    ).rejects.toBeInstanceOf(OfflineLockedError);

    await unlockOfflineKey("u1", PIN);
    await expect(decryptOfflinePayload("u1", "draft:a", sealed)).resolves.toBe(
      "hemmelig",
    );
  });

  it("kan bytte PIN uten å generere ny data-nøkkel", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });
    const sealed = await encryptOfflinePayload("u1", "draft:a", "beholdes");

    await changeOfflinePin("u1", PIN, "654321");
    lockOfflineSession("u1");

    await expect(unlockOfflineKey("u1", PIN)).rejects.toBeInstanceOf(
      OfflinePinError,
    );
    await expect(unlockOfflineKey("u1", "654321")).resolves.toBeUndefined();
    await expect(decryptOfflinePayload("u1", "draft:a", sealed)).resolves.toBe(
      "beholdes",
    );
  });
});

describe("offline-kryptering – manipulering og eierskap", () => {
  it("oppdager endret ciphertext eller IV", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });
    const sealed = await encryptOfflinePayload("u1", "draft:a", sensitiveDraft);

    const first = sealed.payload[0] === "A" ? "B" : "A";
    const tamperedCiphertext = {
      ...sealed,
      payload: first + sealed.payload.slice(1),
    };
    await expect(
      decryptOfflinePayload("u1", "draft:a", tamperedCiphertext),
    ).rejects.toBeInstanceOf(OfflineTamperError);

    const tamperedIv = {
      ...sealed,
      iv: (sealed.iv[0] === "A" ? "B" : "A") + sealed.iv.slice(1),
    };
    await expect(
      decryptOfflinePayload("u1", "draft:a", tamperedIv),
    ).rejects.toBeInstanceOf(OfflineTamperError);
  });

  it("kan ikke dekryptere en annen brukers kladd", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });
    const sealed = await encryptOfflinePayload("u1", "draft:a", sensitiveDraft);
    lockOfflineSession("u1");

    await createOfflineKey("u2", "987654", { iterations: TEST_ITERATIONS });

    await expect(
      decryptOfflinePayload("u2", "draft:a", sealed),
    ).rejects.toBeInstanceOf(OfflineTamperError);
    await expect(
      decryptOfflinePayload("u1", "draft:a", sealed),
    ).rejects.toBeInstanceOf(OfflineLockedError);
  });

  it("binder ciphertexten til postens identitet (AAD)", async () => {
    await createOfflineKey("u1", PIN, { iterations: TEST_ITERATIONS });
    const sealed = await encryptOfflinePayload("u1", "draft:a", "a");

    await expect(
      decryptOfflinePayload("u1", "draft:b", sealed),
    ).rejects.toBeInstanceOf(OfflineTamperError);
  });
});
