import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testene kjører mot en ekte temp-mappe (filbyttet er en del av kontrakten),
 * men Ghostscript er alltid mocket. Dermed krever ikke CI at `gs` er
 * installert, og «manglende Ghostscript» kan testes deterministisk.
 */
const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

import { compressPdfFile } from "./pdf-compress";

let root: string | null = null;

function dir(): string {
  if (!root) throw new Error("Testmappen er ikke satt opp");
  return root;
}

/** Gyldig nok PDF for magi- og %%EOF-kontrollen. */
function pdfBytes(size: number): Buffer {
  if (size < 20) throw new Error("For liten testfil");
  const buffer = Buffer.alloc(size, 0x20);
  buffer.write("%PDF-1.7\n", 0, "latin1");
  buffer.write("%%EOF\n", size - 6, "latin1");
  return buffer;
}

async function write(name: string, data: Buffer): Promise<string> {
  const target = path.join(dir(), name);
  await fs.writeFile(target, data);
  return target;
}

type SpawnBehavior = (command: string, args: string[]) => number | void;

/**
 * Erstatter `spawn` med en falsk prosess. Returverdien er exitkoden; kast en
 * feil med `code: "ENOENT"` for å simulere at programmet ikke finnes.
 */
function mockSpawn(behavior: SpawnBehavior) {
  mocks.spawn.mockImplementation((command: string, args: string[]) => {
    const listeners = new Map<string, ((...params: unknown[]) => void)[]>();
    const child = {
      on(event: string, listener: (...params: unknown[]) => void) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return child;
      },
      kill: vi.fn(),
    };
    const emit = (event: string, ...params: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...params);
    };

    void Promise.resolve().then(async () => {
      try {
        const code = behavior(command, args) ?? 0;
        emit("close", code);
      } catch (error) {
        emit("error", error);
      }
    });

    return child;
  });
}

function enoent(): never {
  throw Object.assign(new Error("spawn gs ENOENT"), { code: "ENOENT" });
}

/** Standardoppførsel: `gs --version` svarer OK. */
function gsAvailable(command: string, args: string[]): number | void {
  if (command === "gs" && args[0] === "--version") return 0;
}

function outputPath(args: string[]): string {
  const arg = args.find((value) => value.startsWith("-sOutputFile="));
  if (!arg) throw new Error("Ghostscript-kallet mangler -sOutputFile");
  return arg.slice("-sOutputFile=".length);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-pdf-compress-"));
  mocks.spawn.mockReset();
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = null;
});

describe("compressPdfFile", () => {
  it("hopper over filer under minBytes uten å kjøre Ghostscript", async () => {
    const file = await write("liten.pdf", pdfBytes(500));
    mockSpawn(gsAvailable);

    const result = await compressPdfFile({ path: file, minBytes: 1024 });

    expect(result).toEqual({ ok: false, reason: "too_small" });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect((await fs.stat(file)).size).toBe(500);
  });

  it("rapporterer manglende fil som «missing»", async () => {
    mockSpawn(gsAvailable);
    const result = await compressPdfFile({
      path: path.join(dir(), "finnes-ikke.pdf"),
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("gir «no_ghostscript» når gs ikke finnes på PATH", async () => {
    const file = await write("skannet.pdf", pdfBytes(4096));
    mockSpawn(() => enoent());

    const result = await compressPdfFile({ path: file });

    expect(result).toEqual({ ok: false, reason: "no_ghostscript" });
    expect((await fs.stat(file)).size).toBe(4096);
  });

  it("beholder originalen når gevinsten er under 10 prosent", async () => {
    const original = pdfBytes(4096);
    const file = await write("nesten.pdf", original);
    mockSpawn((command, args) => {
      if (command === "gs" && args[0] === "--version") return 0;
      // 95 % av originalen: for lite til å forsvare et bytte.
      writeFileSync(outputPath(args), pdfBytes(3891));
      return 0;
    });

    const result = await compressPdfFile({ path: file });

    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(await fs.readFile(file)).toEqual(original);
    // Temp-filen skal være ryddet bort.
    expect(await fs.readdir(dir())).toEqual(["nesten.pdf"]);
  });

  it("bytter filen og rapporterer bytes når komprimeringen lykkes", async () => {
    const file = await write("stor.pdf", pdfBytes(10_000));
    mockSpawn((command, args) => {
      if (command === "gs" && args[0] === "--version") return 0;
      writeFileSync(outputPath(args), pdfBytes(3000));
      return 0;
    });

    const result = await compressPdfFile({ path: file });

    expect(result).toEqual({ ok: true, bytesBefore: 10_000, bytesAfter: 3000 });
    expect((await fs.stat(file)).size).toBe(3000);
    expect(await fs.readFile(file, "latin1")).toContain("%PDF-");
    expect(await fs.readdir(dir())).toEqual(["stor.pdf"]);
  });

  it("forkaster output som ikke er en gyldig PDF", async () => {
    const original = pdfBytes(8192);
    const file = await write("rart.pdf", original);
    mockSpawn((command, args) => {
      if (command === "gs" && args[0] === "--version") return 0;
      writeFileSync(outputPath(args), Buffer.alloc(1024, 0x41));
      return 0;
    });

    const result = await compressPdfFile({ path: file });

    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(await fs.readFile(file)).toEqual(original);
    expect(await fs.readdir(dir())).toEqual(["rart.pdf"]);
  });

  it("beholder originalen når Ghostscript feiler", async () => {
    const original = pdfBytes(8192);
    const file = await write("ødelagt.pdf", original);
    mockSpawn((command, args) => {
      if (command === "gs" && args[0] === "--version") return 0;
      writeFileSync(outputPath(args), pdfBytes(1024));
      return 1;
    });

    const result = await compressPdfFile({ path: file });

    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(await fs.readFile(file)).toEqual(original);
    expect(await fs.readdir(dir())).toEqual(["ødelagt.pdf"]);
  });
});
