import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rootDir: "",
  findMany: vi.fn(),
  write: vi.fn(),
  writeFromFile: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { upload: { findMany: mocks.findMany } },
}));

// Opplastingslaget mockes bare for opplastings-testene nederst. Dedupe-skann-
// ingen får roten eksplisitt og rører aldri `uploadDir()`.
vi.mock("@/lib/uploads", () => ({
  uploadDir: () => mocks.rootDir,
  writeUploadFile: mocks.write,
  uploadStorage: () => ({
    kind: "local",
    localPath: (key: string) => path.join(mocks.rootDir, key),
    writeFromFile: mocks.writeFromFile,
  }),
}));

import { dedupeUploads, linkFileOver } from "./upload-dedupe";
import { storeUploadBytes, storeUploadFromFile } from "./upload-store";

let root: string | null = null;

function dir(): string {
  if (!root) throw new Error("Testmappen er ikke satt opp");
  return root;
}

async function write(name: string, content: Buffer | string): Promise<string> {
  const target = path.join(dir(), name);
  await fs.writeFile(target, content);
  return target;
}

function content(seed: string, size = 4096): Buffer {
  // Ikke komprimerbart og ulikt per seed, slik at filene er ekte duplikater
  // eller ekte ulike – ikke tilfeldig like.
  const buffer = Buffer.alloc(size, seed);
  buffer.write(`%PDF-1.4\n${seed}\n`, 0, "utf8");
  return buffer;
}

async function inodeOf(name: string): Promise<{ ino: number; nlink: number }> {
  const info = await fs.stat(path.join(dir(), name));
  return { ino: info.ino, nlink: info.nlink };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-dedupe-"));
  mocks.rootDir = root;
  mocks.findMany.mockReset().mockResolvedValue([]);
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.writeFromFile.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = null;
  mocks.rootDir = "";
});

describe("dedupeUploads", () => {
  it("hardlenker identiske filer og lar ulike filer være i fred", async () => {
    const payload = content("a");
    await write("a.pdf", payload);
    await write("b.pdf", payload);
    await write("c.pdf", payload);
    await write("unik.pdf", content("b"));

    const stats = await dedupeUploads({ root: dir(), apply: true });

    expect(stats.scanned).toBe(4);
    expect(stats.deduped).toBe(2);
    expect(stats.alreadyLinked).toBe(0);
    expect(stats.savedBytes).toBe(payload.length * 2);
    expect(stats.errors).toBe(0);

    const [a, b, c, unique] = await Promise.all([
      inodeOf("a.pdf"),
      inodeOf("b.pdf"),
      inodeOf("c.pdf"),
      inodeOf("unik.pdf"),
    ]);
    expect(b.ino).toBe(a.ino);
    expect(c.ino).toBe(a.ino);
    expect(a.nlink).toBe(3);
    expect(unique.ino).not.toBe(a.ino);
    expect(unique.nlink).toBe(1);

    // Navnene og innholdet er urørt – bare inoden deles.
    const names = (await fs.readdir(dir())).sort();
    expect(names).toEqual(["a.pdf", "b.pdf", "c.pdf", "unik.pdf"]);
    await expect(fs.readFile(path.join(dir(), "b.pdf"))).resolves.toEqual(payload);
    await expect(fs.readFile(path.join(dir(), "unik.pdf"))).resolves.toEqual(
      content("b"),
    );
  });

  it("tørrkjøring rapporterer besparelsen uten å skrive noe", async () => {
    const payload = content("dry");
    await write("a.pdf", payload);
    await write("b.pdf", payload);
    await write("c.pdf", payload);

    const before = await Promise.all([
      inodeOf("a.pdf"),
      inodeOf("b.pdf"),
      inodeOf("c.pdf"),
    ]);

    const stats = await dedupeUploads({ root: dir(), apply: false });

    expect(stats.deduped).toBe(2);
    expect(stats.savedBytes).toBe(payload.length * 2);
    expect(stats.errors).toBe(0);

    const after = await Promise.all([
      inodeOf("a.pdf"),
      inodeOf("b.pdf"),
      inodeOf("c.pdf"),
    ]);
    expect(after.map((entry) => entry.ino)).toEqual(
      before.map((entry) => entry.ino),
    );
    expect(after.map((entry) => entry.nlink)).toEqual([1, 1, 1]);
    await expect(fs.readFile(path.join(dir(), "c.pdf"))).resolves.toEqual(payload);
  });

  it("er idempotent: andre kjøring lenker ingenting og sparer null", async () => {
    const payload = content("idem");
    await write("a.pdf", payload);
    await write("b.pdf", payload);
    await write("c.pdf", payload);

    const first = await dedupeUploads({ root: dir(), apply: true });
    expect(first.deduped).toBe(2);

    const second = await dedupeUploads({ root: dir(), apply: true });

    expect(second.deduped).toBe(0);
    expect(second.alreadyLinked).toBe(2);
    expect(second.savedBytes).toBe(0);
    expect(second.errors).toBe(0);
    expect((await inodeOf("b.pdf")).ino).toBe((await inodeOf("a.pdf")).ino);
  });

  it("teller feil på én fil og fortsetter med resten", async () => {
    const payload = content("feil");
    await write("a.pdf", payload);
    await write("b.pdf", payload);
    await write("skadet.pdf", content("skadet"));
    await write("c.pdf", content("c"));
    await write("d.pdf", content("c"));

    const stats = await dedupeUploads({
      root: dir(),
      apply: true,
      hashFile: async (absolute) => {
        if (path.basename(absolute) === "skadet.pdf") {
          throw new Error("kunne ikke lese");
        }
        const data = await fs.readFile(absolute);
        return data.toString("base64");
      },
    });

    expect(stats.errors).toBe(1);
    expect(stats.deduped).toBe(2);
    expect(stats.savedBytes).toBe(payload.length + content("c").length);

    expect((await inodeOf("b.pdf")).ino).toBe((await inodeOf("a.pdf")).ino);
    expect((await inodeOf("d.pdf")).ino).toBe((await inodeOf("c.pdf")).ino);
    // Den skadde filen er urørt og fortsatt lesbar.
    await expect(fs.readFile(path.join(dir(), "skadet.pdf"))).resolves.toEqual(
      content("skadet"),
    );
  });

  it("hopper over små filer og skjulte mapper", async () => {
    await write("liten-a.pdf", "kort");
    await write("liten-b.pdf", "kort");

    const payload = content("tmp");
    await fs.mkdir(path.join(dir(), ".tmp"), { recursive: true });
    await fs.writeFile(path.join(dir(), ".tmp", "a.pdf"), payload);
    await fs.writeFile(path.join(dir(), ".tmp", "b.pdf"), payload);

    const stats = await dedupeUploads({
      root: dir(),
      apply: true,
      minBytes: 100,
    });

    expect(stats.deduped).toBe(0);
    expect(stats.savedBytes).toBe(0);
    expect((await inodeOf("liten-a.pdf")).nlink).toBe(1);
    const tmpA = await fs.stat(path.join(dir(), ".tmp", "a.pdf"));
    const tmpB = await fs.stat(path.join(dir(), ".tmp", "b.pdf"));
    expect(tmpB.ino).not.toBe(tmpA.ino);
    expect(tmpA.nlink).toBe(1);
  });
});

describe("linkFileOver", () => {
  it("erstatter målet med en hardlenke og beholder innholdet", async () => {
    const payload = content("lenke");
    const source = await write("kilde.pdf", payload);
    const target = await write("mål.pdf", content("annet"));

    await linkFileOver(source, target);

    const [sourceInfo, targetInfo] = await Promise.all([
      fs.stat(source),
      fs.stat(target),
    ]);
    expect(targetInfo.ino).toBe(sourceInfo.ino);
    expect(sourceInfo.nlink).toBe(2);
    await expect(fs.readFile(target)).resolves.toEqual(payload);
    // Ingen midlertidige rester etter den atomiske utskiftingen.
    expect((await fs.readdir(dir())).sort()).toEqual(["kilde.pdf", "mål.pdf"]);
  });
});

describe("dedupe ved opplasting", () => {
  it("lenker til en eldre opplasting med samme innhold i stedet for å skrive", async () => {
    const payload = content("opplasting");
    await write("eldre.pdf", payload);
    mocks.findMany.mockResolvedValue([{ storedName: "eldre.pdf" }]);

    const stored = await storeUploadBytes({
      storedName: "ny.pdf",
      data: payload,
      mimeType: "application/pdf",
    });

    expect(stored).toMatchObject({ storedName: "ny.pdf", deduped: true });
    expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.write).not.toHaveBeenCalled();

    const [ny, eldre] = await Promise.all([inodeOf("ny.pdf"), inodeOf("eldre.pdf")]);
    expect(ny.ino).toBe(eldre.ino);
    expect(ny.nlink).toBe(2);
    await expect(fs.readFile(path.join(dir(), "ny.pdf"))).resolves.toEqual(payload);

    // Sletting av den ene raden fjerner bare dens egen lenke; den eldre filen
    // beholder innholdet.
    await fs.unlink(path.join(dir(), "ny.pdf"));
    expect((await inodeOf("eldre.pdf")).nlink).toBe(1);
    await expect(fs.readFile(path.join(dir(), "eldre.pdf"))).resolves.toEqual(
      payload,
    );
  });

  it("skriver vanlig når ingen identisk fil finnes", async () => {
    const payload = content("ny");
    mocks.findMany.mockResolvedValue([]);

    const stored = await storeUploadBytes({
      storedName: "ny.pdf",
      data: payload,
      mimeType: "application/pdf",
    });

    expect(stored.deduped).toBe(false);
    expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.write).toHaveBeenCalledWith("ny.pdf", payload, "application/pdf");
  });

  it("faller tilbake til vanlig skriving når lenking feiler", async () => {
    const payload = content("borte");
    // Raden finnes, men filen er slettet – lenken kan ikke lages.
    mocks.findMany.mockResolvedValue([{ storedName: "forsvunnet.pdf" }]);

    const stored = await storeUploadBytes({
      storedName: "ny.pdf",
      data: payload,
      mimeType: "application/pdf",
    });

    expect(stored.deduped).toBe(false);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(dir())).toEqual([]);
  });

  it("hashleser strømmende og lenker filer som kommer fra en temp-fil", async () => {
    const payload = content("temp");
    await write("eldre.pdf", payload);
    const temp = path.join(dir(), ".tmp-opplasting.pdf");
    await fs.writeFile(temp, payload);
    mocks.findMany.mockResolvedValue([{ storedName: "eldre.pdf" }]);

    const stored = await storeUploadFromFile({
      storedName: "ny.pdf",
      sourcePath: temp,
      mimeType: "application/pdf",
    });

    expect(stored.deduped).toBe(true);
    expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.writeFromFile).not.toHaveBeenCalled();
    const [ny, eldre] = await Promise.all([inodeOf("ny.pdf"), inodeOf("eldre.pdf")]);
    expect(ny.ino).toBe(eldre.ino);
    // Kilden er urørt; det er opplastingsruten som rydder temp-filen.
    await expect(fs.readFile(temp)).resolves.toEqual(payload);
  });
});
