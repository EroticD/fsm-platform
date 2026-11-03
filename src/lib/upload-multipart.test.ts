import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupUploadTempFiles,
  multipartBoundary,
  readMultipartUpload,
} from "./upload-multipart";

const BOUNDARY = "----fsm-test-boundary";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-upload-test-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function body(parts: Array<{ name: string; value: string | Buffer; filename?: string; type?: string }>) {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    chunks.push(Buffer.from(`Content-Disposition: ${disposition}\r\n`));
    if (part.type) chunks.push(Buffer.from(`Content-Type: ${part.type}\r\n`));
    chunks.push(Buffer.from("\r\n"));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

function request(buffer: Buffer, contentType = `multipart/form-data; boundary=${BOUNDARY}`) {
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
          controller.enqueue(
            new Uint8Array(buffer.subarray(offset, offset + 64 * 1024)),
          );
        }
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
}

describe("multipartBoundary", () => {
  it("leser grense med og uten anførselstegn", () => {
    expect(multipartBoundary(`multipart/form-data; boundary=${BOUNDARY}`)).toBe(
      BOUNDARY,
    );
    expect(
      multipartBoundary('multipart/form-data; boundary="abc-123"; charset=utf-8'),
    ).toBe("abc-123");
    expect(multipartBoundary("application/json")).toBeNull();
  });
});

describe("readMultipartUpload", () => {
  it("strømmer filen til en midlertidig fil og leser skjemafelt", async () => {
    const pdf = Buffer.from("%PDF-1.7\n" + "x".repeat(200_000));
    const result = await readMultipartUpload(
      request(
        body([
          { name: "workOrderId", value: "wo1" },
          { name: "file", value: pdf, filename: "rapport.pdf", type: "application/pdf" },
        ]),
      ),
      { maxRequestBytes: 2_000_000, maxFileBytes: 2_000_000, tempDir },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("forventet ok");
    expect(result.data.fields.workOrderId).toBe("wo1");
    expect(result.data.file).toMatchObject({
      fieldName: "file",
      fileName: "rapport.pdf",
      contentType: "application/pdf",
      size: pdf.length,
    });
    expect(result.data.file?.headerBytes.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(fs.readFile(result.data.file!.tempPath)).resolves.toEqual(pdf);
    await fs.unlink(result.data.file!.tempPath);
  });

  it("avviser for stor fil og rydder den midlertidige filen", async () => {
    const result = await readMultipartUpload(
      request(
        body([
          {
            name: "file",
            value: Buffer.alloc(300_000, 0x61),
            filename: "stor.pdf",
            type: "application/pdf",
          },
        ]),
      ),
      { maxRequestBytes: 2_000_000, maxFileBytes: 100_000, tempDir },
    );

    expect(result).toEqual({ ok: false, reason: "too_large" });
    const entries = await fs.readdir(path.join(tempDir, ".tmp")).catch(() => []);
    expect(entries).toEqual([]);
  });

  it("avviser en forespørsel uten fil", async () => {
    const result = await readMultipartUpload(
      request(body([{ name: "workOrderId", value: "wo1" }])),
      { maxRequestBytes: 2_000_000, maxFileBytes: 2_000_000, tempDir },
    );

    expect(result).toEqual({ ok: false, reason: "no_file" });
  });

  it("holder fire samtidige store opplastinger hver for seg", async () => {
    const uploads = Array.from({ length: 4 }, (_, index) => {
      const pdf = Buffer.from(`%PDF-1.7\n${String(index).repeat(1_000_000)}`);
      return readMultipartUpload(
        request(
          body([
            { name: "purpose", value: `doc-${index}` },
            { name: "file", value: pdf, filename: `${index}.pdf`, type: "application/pdf" },
          ]),
        ),
        { maxRequestBytes: 2_000_000, maxFileBytes: 2_000_000, tempDir },
      );
    });

    const results = await Promise.all(uploads);
    for (const [index, result] of results.entries()) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.data.fields.purpose).toBe(`doc-${index}`);
      const content = await fs.readFile(result.data.file!.tempPath, "utf8");
      expect(content.startsWith(`%PDF-1.7\n${index}`)).toBe(true);
      expect(content.endsWith(String(index))).toBe(true);
      await fs.unlink(result.data.file!.tempPath);
    }
  });
});

describe("cleanupUploadTempFiles", () => {
  it("fjerner gamle midlertidige filer, men ikke ferske", async () => {
    const directory = path.join(tempDir, ".tmp");
    await fs.mkdir(directory, { recursive: true });
    const oldFile = path.join(directory, "gammel.part");
    const freshFile = path.join(directory, "fersk.part");
    await fs.writeFile(oldFile, "x");
    await fs.writeFile(freshFile, "x");
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(oldFile, old, old);

    const result = await cleanupUploadTempFiles({ tempDir, olderThanHours: 24 });

    expect(result.removed).toBe(1);
    await expect(fs.stat(oldFile)).rejects.toThrow();
    await expect(fs.stat(freshFile)).resolves.toBeTruthy();
  });
});
