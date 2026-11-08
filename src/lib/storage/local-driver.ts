// i18n-ignore-file: fillagringens logger er driftsdata.
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { normaliseStorageKey } from "./keys";
import type {
  StorageDriver,
  StorageObject,
  StorageStreamOptions,
} from "./types";

/**
 * Lokal diskdriver. Oppførselen er den samme som appen hadde før
 * storage-abstraksjonen: filer ligger under `UPLOAD_DIR`, med 0600 der det er
 * mulig, og `/uploads/<navn>` leses fra samme rot.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = "local" as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const normalised = normaliseStorageKey(key);
    const absoluteRoot = path.resolve(this.root);
    const target = path.resolve(absoluteRoot, ...normalised.split("/"));
    if (target !== absoluteRoot && !target.startsWith(absoluteRoot + path.sep)) {
      throw new Error("Lagringsnøkkelen peker utenfor opplastingsmappen");
    }
    return target;
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async write(
    key: string,
    data: Buffer | Uint8Array | string,
  ): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, data, { mode: 0o600 });
  }

  async writeFromFile(key: string, sourcePath: string): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      // Samme filsystem: flytt er både raskere og atomisk. Krysser vi et
      // monteringspunkt, faller vi tilbake til kopi.
      await fs.rename(sourcePath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await fs.copyFile(sourcePath, target);
      await fs.chmod(target, 0o600).catch(() => undefined);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async stat(key: string): Promise<StorageObject | null> {
    try {
      const info = await fs.stat(this.resolve(key));
      if (!info.isFile()) return null;
      return {
        key: normaliseStorageKey(key),
        size: info.size,
        lastModified: info.mtime,
        contentType: null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(prefix?: string): Promise<StorageObject[]> {
    const normalisedPrefix = prefix ? normaliseStorageKey(prefix) : "";
    const results: StorageObject[] = [];

    const walk = async (directory: string) => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        // Symlinks kan peke ut av roten og skal aldri følges.
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        const relative = path
          .relative(path.resolve(this.root), absolute)
          .split(path.sep)
          .join("/");
        if (normalisedPrefix && !relative.startsWith(`${normalisedPrefix}/`)) {
          continue;
        }
        const info = await fs.stat(absolute).catch(() => null);
        if (!info?.isFile()) continue;
        results.push({
          key: relative,
          size: info.size,
          lastModified: info.mtime,
          contentType: null,
        });
      }
    };

    await walk(path.resolve(this.root));
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  async stream(
    key: string,
    options?: StorageStreamOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const absolute = this.resolve(key);
    const nodeStream = createReadStream(absolute, {
      ...(options?.start !== undefined ? { start: options.start } : {}),
      ...(options?.end !== undefined ? { end: options.end } : {}),
    });
    nodeStream.on("error", () => undefined);
    return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  }

  async healthCheck(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await fs.access(this.root, constants.W_OK);
  }

  localPath(key: string): string {
    return this.resolve(key);
  }
}
