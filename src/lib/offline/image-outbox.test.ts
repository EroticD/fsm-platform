import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOfflineImagesForReport,
  flushOfflineImages,
  listOfflineImages,
  offlineReportId,
  queueOfflineImage,
  removeOfflineImage,
} from "./image-outbox";
import { listStoredOfflineImages } from "./db";

/**
 * Håndrullet IndexedDB-fake, som i `db.test.ts`. Den dekker bare det
 * bildekøen bruker (put/get/getAll/delete/clear) og opprettelsen av stores i
 * `onupgradeneeded`, slik at migreringen fra versjon 2 faktisk kjøres.
 */
type Row = { id?: string; key?: string; [key: string]: unknown };

function installLocalStorage(userId: string | null) {
  const values = new Map<string, string>();
  if (userId) values.set("fsm:offline-user", userId);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
}

function installFakeIndexedDb() {
  // Versjon 2-databasen: de eksisterende storene finnes fra før, og
  // `images` opprettes først av migreringen.
  const stores = new Map<string, Map<string, Row>>([
    ["drafts", new Map()],
    ["outbox", new Map()],
    ["visit-statuses", new Map()],
  ]);

  function storeFor(name: string) {
    const values = stores.get(name);
    if (!values) throw new Error(`Ukjent store ${name}`);
    const later = <T,>(result: T) => {
      const request = {
        result,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => request.onsuccess?.(), 0);
      return request;
    };
    return {
      put(value: Row) {
        values.set(value.id ?? value.key ?? "", value);
      },
      get(key: string) {
        return later(values.get(key) ?? null);
      },
      getAll() {
        return later([...values.values()]);
      },
      delete(key: string) {
        values.delete(key);
      },
      clear() {
        values.clear();
      },
      count() {
        return values.size;
      },
    };
  }

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
    },
    transaction(name: string) {
      const store = storeFor(name);
      let complete: (() => void) | null = null;
      return {
        objectStore: () => store,
        error: null,
        get oncomplete() {
          return complete;
        },
        set oncomplete(handler: (() => void) | null) {
          complete = handler;
          if (handler) setTimeout(handler, 0);
        },
        onerror: null,
        onabort: null,
      };
    },
    close() {},
  };

  vi.stubGlobal("indexedDB", {
    open() {
      const request = {
        result: db,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      setTimeout(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  });

  return stores;
}

function imageBlob(text: string): Blob {
  return new Blob([text], { type: "image/jpeg" });
}

let stores: ReturnType<typeof installFakeIndexedDb>;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("navigator", { onLine: true });
  installLocalStorage("u1");
  stores = installFakeIndexedDb();
});

describe("DB-migrering (versjon 2 → 3)", () => {
  it("legger til bildekøen uten å røre eksisterende stores eller rader", async () => {
    const drafts = stores.get("drafts");
    const outbox = stores.get("outbox");
    expect(drafts).toBeDefined();
    expect(outbox).toBeDefined();
    drafts?.set("draft-1", { key: "draft-1", userId: "u1", payload: "cipher" });
    outbox?.set("outbox-1", { id: "outbox-1", userId: "u1", payload: "cipher" });

    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("a"),
    });

    // Migreringen har opprettet bildestoren, og de gamle radene står urørt.
    expect(stores.has("images")).toBe(true);
    expect(stores.has("visit-statuses")).toBe(true);
    expect(drafts?.get("draft-1")).toMatchObject({ payload: "cipher" });
    expect(outbox?.get("outbox-1")).toMatchObject({ payload: "cipher" });
  });
});

describe("queueOfflineImage", () => {
  it("lagrer blobben med navn, type, størrelse og eier", async () => {
    const blob = new Blob(["bilde-innhold"], { type: "image/png" });
    const result = await queueOfflineImage({
      reportId: offlineReportId("wo1", "tpl1"),
      unitKey: "unit-0",
      fieldId: "f_image",
      file: blob,
      name: "bilde.png",
    });

    expect(result).toBe("queued");
    const images = await listOfflineImages(offlineReportId("wo1", "tpl1"));
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f_image",
      userId: "u1",
      name: "bilde.png",
      type: "image/png",
      size: blob.size,
    });
    // Selve bildet er fortsatt en Blob – ikke serialisert til tekst.
    expect(images[0].blob).toBeInstanceOf(Blob);
    expect(await images[0].blob.text()).toBe("bilde-innhold");
  });

  it("bevarer store blobs uten å endre innholdet", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    bytes[0] = 42;
    bytes[bytes.length - 1] = 24;
    const blob = new Blob([bytes], { type: "image/jpeg" });

    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f_image",
      file: blob,
      name: "stor.jpg",
    });

    const [stored] = await listOfflineImages("wo1:tpl1");
    expect(stored.size).toBe(bytes.length);
    expect(stored.blob.size).toBe(bytes.length);
    const roundTrip = new Uint8Array(await stored.blob.arrayBuffer());
    expect(roundTrip[0]).toBe(42);
    expect(roundTrip[roundTrip.length - 1]).toBe(24);
    expect(roundTrip[1024]).toBe(bytes[1024]);
  });

  it("bruker en eksplisitt id, slik at feltet kan oppdatere riktig rad", async () => {
    await queueOfflineImage({
      id: "rad-1",
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f_image",
      file: imageBlob("a"),
    });

    const [stored] = await listStoredOfflineImages();
    expect(stored.id).toBe("rad-1");
  });
});

describe("listOfflineImages", () => {
  it("lister bare bildene for rapporten", async () => {
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("1"),
      name: "1.jpg",
    });
    await queueOfflineImage({
      reportId: "wo1:tpl2",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("2"),
      name: "2.jpg",
    });
    await queueOfflineImage({
      reportId: "wo2:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("3"),
      name: "3.jpg",
    });

    const forTpl1 = await listOfflineImages("wo1:tpl1");
    expect(forTpl1.map((image) => image.name)).toEqual(["1.jpg"]);
  });

  it("tar med poster uten kjent eier, men ikke andre brukeres", async () => {
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("min"),
      name: "min.jpg",
      userId: "u1",
    });
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f2",
      file: imageBlob("ukjent"),
      name: "ukjent.jpg",
      userId: null,
    });
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f3",
      file: imageBlob("annen"),
      name: "annen.jpg",
      userId: "u2",
    });

    const mine = await listOfflineImages("wo1:tpl1", { userId: "u1" });
    expect(mine.map((image) => image.name).sort()).toEqual([
      "min.jpg",
      "ukjent.jpg",
    ]);
    expect(await listOfflineImages("wo1:tpl1")).toHaveLength(3);
  });

  it("returnerer tom liste når IndexedDB ikke er tilgjengelig", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await listOfflineImages("wo1:tpl1")).toEqual([]);
  });
});

describe("removeOfflineImage", () => {
  it("fjerner bare det valgte bildet", async () => {
    await queueOfflineImage({
      id: "behold",
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("a"),
    });
    await queueOfflineImage({
      id: "fjern",
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("b"),
    });

    await removeOfflineImage("fjern");

    const remaining = await listOfflineImages("wo1:tpl1");
    expect(remaining.map((image) => image.id)).toEqual(["behold"]);
  });
});

describe("clearOfflineImagesForReport", () => {
  it("tømmer rapporten, men beholder andre rapporter og andre brukere", async () => {
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("a"),
    });
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f2",
      file: imageBlob("b"),
    });
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f3",
      file: imageBlob("annen bruker"),
      userId: "u2",
    });
    // Tatt før brukeren ble husket i nettleseren: regnes som denne brukerens.
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f4",
      file: imageBlob("ukjent eier"),
      userId: null,
    });
    await queueOfflineImage({
      reportId: "wo1:tpl2",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("annen mal"),
    });

    const removed = await clearOfflineImagesForReport("wo1:tpl1", {
      userId: "u1",
    });

    expect(removed).toBe(3);
    expect(await listOfflineImages("wo1:tpl1")).toHaveLength(1);
    expect(await listOfflineImages("wo1:tpl1", { userId: "u2" })).toHaveLength(
      1,
    );
    expect(await listOfflineImages("wo1:tpl2")).toHaveLength(1);
  });
});

describe("flushOfflineImages", () => {
  it("fjerner kvitterte bilder og lar feilende ligge", async () => {
    await queueOfflineImage({
      id: "ok",
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("ok"),
      name: "ok.jpg",
    });
    await queueOfflineImage({
      id: "feil",
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("feil"),
      name: "feil.jpg",
    });

    const upload = vi.fn(async (image: { id: string; name: string }) => {
      if (image.name === "feil.jpg") throw new Error("http-500");
      return `/uploads/${image.id}.jpg`;
    });

    const result = await flushOfflineImages("wo1:tpl1", upload);

    expect(result.uploaded).toEqual([
      {
        id: "ok",
        url: "/uploads/ok.jpg",
        unitKey: "unit-0",
        fieldId: "f1",
        name: "ok.jpg",
      },
    ]);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(1);
    const remaining = await listOfflineImages("wo1:tpl1");
    expect(remaining.map((image) => image.id)).toEqual(["feil"]);
  });

  it("tømmer bare bildene til feltet den får oppgitt", async () => {
    await queueOfflineImage({
      id: "f1-bilde",
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("a"),
    });
    await queueOfflineImage({
      id: "f2-bilde",
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f2",
      file: imageBlob("b"),
    });

    const upload = vi.fn(async (image: { id: string }) => `/uploads/${image.id}.jpg`);
    const result = await flushOfflineImages("wo1:tpl1", upload, {
      fieldId: "f1",
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.uploaded.map((entry) => entry.id)).toEqual(["f1-bilde"]);
    expect(result.pending).toBe(0);
    const remaining = await listOfflineImages("wo1:tpl1");
    expect(remaining.map((image) => image.id)).toEqual(["f2-bilde"]);
  });

  it("gjør ingenting når nettleseren er offline", async () => {
    await queueOfflineImage({
      reportId: "wo1:tpl1",
      unitKey: "unit-0",
      fieldId: "f1",
      file: imageBlob("a"),
    });
    vi.stubGlobal("navigator", { onLine: false });

    const upload = vi.fn(async () => "/uploads/a.jpg");
    const result = await flushOfflineImages("wo1:tpl1", upload);

    expect(upload).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
    expect(result.uploaded).toEqual([]);
  });
});
