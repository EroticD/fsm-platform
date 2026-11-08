import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageDriver } from "./local-driver";

let root: string;
let driver: LocalStorageDriver;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-storage-local-"));
  driver = new LocalStorageDriver(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("LocalStorageDriver", () => {
  it("skriver, leser og sletter en fil med samme nøkkel", async () => {
    await driver.write("fil.txt", "innhold");
    await expect(driver.read("fil.txt")).resolves.toEqual(Buffer.from("innhold"));
    expect(await driver.stat("fil.txt")).toMatchObject({ key: "fil.txt", size: 7 });
    await driver.delete("fil.txt");
    await expect(driver.stat("fil.txt")).resolves.toBeNull();
    await expect(driver.read("fil.txt")).rejects.toBeTruthy();
  });

  it("støtter underkataloger og list med prefiks", async () => {
    await driver.write(".transfer/job-a/package.zip", "a");
    await driver.write(".transfer/job-b/package.zip", "b");
    await driver.write("vanlig.pdf", "c");

    const transfer = await driver.list(".transfer");
    expect(transfer.map((object) => object.key)).toEqual([
      ".transfer/job-a/package.zip",
      ".transfer/job-b/package.zip",
    ]);
    expect(await driver.list("vanlig")).toEqual([]);
  });

  it("strømmer innhold og støtter byte-område", async () => {
    await driver.write("a.txt", "0123456789");
    await expect(streamText(await driver.stream("a.txt"))).resolves.toBe(
      "0123456789",
    );
    await expect(
      streamText(await driver.stream("a.txt", { start: 2, end: 4 })),
    ).resolves.toBe("234");
  });

  it("skriver fra en lokal fil og beholder innholdet", async () => {
    const source = path.join(root, "temp.bin");
    await fs.writeFile(source, "flytt meg");
    await driver.writeFromFile("endelig.bin", source);
    await expect(driver.read("endelig.bin")).resolves.toEqual(
      Buffer.from("flytt meg"),
    );
  });

  it("nektet å lese utenfor roten", async () => {
    await expect(driver.read("../hemmelig.txt")).rejects.toThrow();
    await expect(driver.stat("/etc/passwd")).rejects.toThrow();
  });

  it("localPath returnerer absolutt sti for verktøy som trenger disk", async () => {
    expect(driver.localPath("a/b.pdf")).toBe(path.join(root, "a", "b.pdf"));
  });

  it("healthCheck oppretter roten", async () => {
    const nested = path.join(root, "ny", "mappe");
    const fresh = new LocalStorageDriver(nested);
    await fresh.healthCheck();
    await expect(fs.stat(nested)).resolves.toMatchObject({});
  });
});
