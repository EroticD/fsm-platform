import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";

/**
 * Strømmende multipart-parser for opplastinger.
 *
 * `Request.formData()` buffer hele kroppen i minnet. En PDF på 50 MB ganger
 * flere samtidige forespørsler kan derfor spise opp Node-prosessen. Denne
 * parseren skriver filinnholdet direkte til en midlertidig fil mens den leser,
 * og holder bare en liten vindusbuffer i minnet (nok til å finne neste
 * multipart-grense).
 *
 * Alle grenser håndheves underveis: hele forespørselen, hver enkelt fil og
 * skjemafelt. Ved feil slettes den midlertidige filen før funksjonen
 * returnerer, slik at det ikke blir liggende igjen orphan-filer.
 */

export const MAX_FIELD_BYTES = 64 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FIELDS = 32;

export type StreamedFile = {
  fieldName: string;
  fileName: string;
  contentType: string;
  size: number;
  /** Første bytes av filen, brukt til å avvise løgnaktig MIME-type. */
  headerBytes: Buffer;
  tempPath: string;
};

export type ParsedMultipart = {
  fields: Record<string, string>;
  file: StreamedFile | null;
};

export type MultipartError =
  | "missing_boundary"
  | "invalid_body"
  | "no_file"
  | "too_large"
  | "too_many_fields"
  | "too_many_files"
  | "unreadable";

export type MultipartResult =
  | { ok: true; data: ParsedMultipart }
  | { ok: false; reason: MultipartError };

type PartHeaders = {
  name: string;
  fileName: string | null;
  contentType: string;
};

function parseContentDisposition(value: string): {
  name: string;
  fileName: string | null;
} {
  const nameMatch = /(?:^|;)\s*name="([^"]*)"/i.exec(value);
  const fileMatch = /(?:^|;)\s*filename="([^"]*)"/i.exec(value);
  const unquotedFileMatch = /(?:^|;)\s*filename=([^;]+)/i.exec(value);
  return {
    name: nameMatch?.[1] ?? "",
    fileName:
      fileMatch?.[1] ??
      (unquotedFileMatch ? unquotedFileMatch[1].trim() : null),
  };
}

function parsePartHeaders(raw: string): PartHeaders | null {
  const lines = raw.split("\r\n");
  let disposition = "";
  let contentType = "";
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (name === "content-disposition") disposition = value;
    if (name === "content-type") contentType = value;
  }
  if (!disposition) return null;
  const parsed = parseContentDisposition(disposition);
  if (!parsed.name) return null;
  return {
    name: parsed.name,
    fileName: parsed.fileName,
    contentType: contentType.split(";")[0]?.trim().toLowerCase() ?? "",
  };
}

/** Henter multipart-grensen fra Content-Type, med eller uten anførselstegn. */
export function multipartBoundary(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = (match?.[1] ?? match?.[2] ?? "").trim();
  return value ? value : null;
}

/**
 * Leser en multipart-forespørsel og skriver eventuell fil til `tempDir`.
 *
 * Returnerer bare metadata; eieren må selv flytte eller slette `tempPath`.
 */
export async function readMultipartUpload(
  request: Request,
  options: {
    maxRequestBytes: number;
    maxFileBytes: number;
    tempDir: string;
  },
): Promise<MultipartResult> {
  const boundary = multipartBoundary(request.headers.get("content-type"));
  if (!boundary) return { ok: false, reason: "missing_boundary" };
  if (!request.body) return { ok: false, reason: "invalid_body" };

  const firstBoundary = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  const tempDirectory = path.join(options.tempDir, ".tmp");
  await fs.mkdir(tempDirectory, { recursive: true });

  let buffer = Buffer.alloc(0);
  let state: "preamble" | "headers" | "body" | "afterBoundary" | "done" =
    "preamble";
  let headers: PartHeaders | null = null;
  let currentParts: Buffer[] = [];
  let currentFieldBytes = 0;
  const fields: Record<string, string> = {};
  let file: StreamedFile | null = null;
  let openFile: fs.FileHandle | null = null;
  let tempPath: string | null = null;
  let fileSize = 0;
  let fileHeader = Buffer.alloc(0);
  let total = 0;

  const reader = request.body.getReader();

  const closeFile = async () => {
    if (openFile) {
      await openFile.close().catch(() => undefined);
      openFile = null;
    }
  };

  const removeTemp = async () => {
    await closeFile();
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => undefined);
      tempPath = null;
    }
    // En allerede ferdig fil kan ligge igjen hvis en senere del av
    // forespørselen er ugyldig (for eksempel to filer).
    if (file?.tempPath) {
      await fs.unlink(file.tempPath).catch(() => undefined);
      file = null;
    }
  };

  const appendBody = async (data: Buffer) => {
    if (!data.length) return;
    if (headers?.fileName !== null) {
      if (fileSize + data.length > options.maxFileBytes) {
        throw new Error("too_large");
      }
      if (!openFile || !tempPath) {
        tempPath = path.join(tempDirectory, `${crypto.randomUUID()}.part`);
        openFile = await fs.open(tempPath, "wx");
      }
      if (fileHeader.length < 16) {
        fileHeader = Buffer.concat([
          fileHeader,
          data.subarray(0, 16 - fileHeader.length),
        ]);
      }
      await openFile.write(data);
      fileSize += data.length;
      return;
    }

    currentFieldBytes += data.length;
    if (currentFieldBytes > MAX_FIELD_BYTES) throw new Error("too_many_fields");
    currentParts.push(Buffer.from(data));
  };

  const finalizePart = async () => {
    if (!headers) return;
    if (headers.fileName !== null) {
      if (file) throw new Error("too_many_files");
      if (headers.name !== "file") throw new Error("too_many_files");
      if (!tempPath || !openFile) {
        // En tom fil er fortsatt en fil; lag en tom midlertidig fil.
        tempPath = path.join(tempDirectory, `${crypto.randomUUID()}.part`);
        openFile = await fs.open(tempPath, "wx");
      }
      await closeFile();
      file = {
        fieldName: headers.name,
        fileName: headers.fileName,
        contentType: headers.contentType,
        size: fileSize,
        headerBytes: fileHeader,
        tempPath,
      };
      tempPath = null;
    } else {
      if (Object.keys(fields).length >= MAX_FIELDS) {
        throw new Error("too_many_fields");
      }
      fields[headers.name] = Buffer.concat(currentParts).toString("utf8");
    }
    headers = null;
    currentParts = [];
    currentFieldBytes = 0;
    fileSize = 0;
    fileHeader = Buffer.alloc(0);
  };

  const consume = (length: number) => {
    buffer = buffer.subarray(length);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > options.maxRequestBytes) {
        await reader.cancel().catch(() => undefined);
        await removeTemp();
        return { ok: false, reason: "too_large" };
      }
      buffer = Buffer.concat([buffer, Buffer.from(value)]);

      // Bearbeid så mye som mulig av bufferen før neste chunk. Filinnhold
      // skrives ut umiddelbart; bare en halv grense holdes tilbake.
      for (;;) {
        if (state === "preamble") {
          const index = buffer.indexOf(firstBoundary);
          if (index === -1) {
            // Preamble skal være liten. Behold bare nok til en delt grense.
            if (buffer.length > firstBoundary.length + MAX_HEADER_BYTES) {
              throw new Error("invalid_body");
            }
            break;
          }
          consume(index + firstBoundary.length);
          state = "afterBoundary";
          continue;
        }

        if (state === "afterBoundary") {
          if (buffer.length < 2) break;
          if (buffer[0] === 0x2d && buffer[1] === 0x2d) {
            consume(2);
            state = "done";
            continue;
          }
          if (buffer[0] !== 0x0d || buffer[1] !== 0x0a) {
            throw new Error("invalid_body");
          }
          consume(2);
          state = "headers";
          continue;
        }

        if (state === "headers") {
          const index = buffer.indexOf("\r\n\r\n");
          if (index === -1) {
            if (buffer.length > MAX_HEADER_BYTES) {
              throw new Error("invalid_body");
            }
            break;
          }
          headers = parsePartHeaders(buffer.subarray(0, index).toString("utf8"));
          if (!headers) throw new Error("invalid_body");
          currentParts = [];
          currentFieldBytes = 0;
          consume(index + 4);
          state = "body";
          continue;
        }

        if (state === "body") {
          const index = buffer.indexOf(separator);
          if (index !== -1) {
            await appendBody(buffer.subarray(0, index));
            consume(index + separator.length);
            await finalizePart();
            state = "afterBoundary";
            continue;
          }
          // Skriv alt unntatt halen som kan være starten på neste grense.
          const keep = separator.length - 1;
          const writable = buffer.length - keep;
          if (writable > 0) {
            await appendBody(buffer.subarray(0, writable));
            consume(writable);
          }
          break;
        }

        if (state === "done") break;
      }

      if (state === "done") break;
    }

    if (state !== "done") throw new Error("invalid_body");
    if (headers) await finalizePart();
    await closeFile();

    if (!file) return { ok: false, reason: "no_file" };
    return { ok: true, data: { fields, file } };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await removeTemp();
    const message = error instanceof Error ? error.message : "";
    if (message === "too_large") return { ok: false, reason: "too_large" };
    if (message === "too_many_fields") {
      return { ok: false, reason: "too_many_fields" };
    }
    if (message === "too_many_files") {
      return { ok: false, reason: "too_many_files" };
    }
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }
}

/** Sletter midlertidige filer fra avbrutte opplastinger eldre enn fristen. */
export async function cleanupUploadTempFiles(options?: {
  olderThanHours?: number;
  tempDir: string;
}): Promise<{ removed: number }> {
  const olderThanHours = Math.max(1, options?.olderThanHours ?? 24);
  const directory = path.join(
    options?.tempDir ?? path.join(process.cwd(), "uploads"),
    ".tmp",
  );
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return { removed };
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        removed += 1;
      }
    } catch {
      // Filen kan være slettet av en samtidig forespørsel.
    }
  }
  return { removed };
}

/** Strømmer en fil fra en Node-leser til en midlertidig fil (for tester). */
export async function writeStreamToTemp(
  stream: Readable,
  tempPath: string,
): Promise<void> {
  const handle = await fs.open(tempPath, "wx");
  try {
    for await (const chunk of stream) {
      await handle.write(chunk as Buffer);
    }
  } finally {
    await handle.close();
  }
}
