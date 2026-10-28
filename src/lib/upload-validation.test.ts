import { describe, expect, it } from "vitest";
import {
  declaredMimeMatches,
  readRequestBodyWithLimit,
  sniffFileMime,
} from "./upload-validation";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("sniffFileMime", () => {
  it("gjenkjenner PDF, JPEG, PNG, GIF og WebP", () => {
    expect(sniffFileMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe(
      "application/pdf",
    );
    expect(sniffFileMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(
      sniffFileMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("image/png");
    expect(sniffFileMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe(
      "image/gif",
    );
    expect(
      sniffFileMime(
        bytes(
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ),
      ),
    ).toBe("image/webp");
  });

  it("avviser innhold som bare hevder å være et bilde", () => {
    expect(sniffFileMime(new TextEncoder().encode("<html>hei</html>"))).toBeNull();
    expect(sniffFileMime(new TextEncoder().encode("MZ executable"))).toBeNull();
  });
});

describe("declaredMimeMatches", () => {
  it("krever at deklarert type stemmer med faktiske bytes", () => {
    expect(declaredMimeMatches("image/png", "image/png")).toBe(true);
    expect(declaredMimeMatches("IMAGE/PNG", "image/png")).toBe(true);
    expect(declaredMimeMatches("image/png", "application/pdf")).toBe(false);
    expect(declaredMimeMatches("image/png", null)).toBe(false);
  });
});

describe("readRequestBodyWithLimit", () => {
  it("leser en vanlig kropp", async () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: "abc",
    });

    const result = await readRequestBodyWithLimit(request, 10);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.buffer.toString()).toBe("abc");
  });

  it("avbryter en chunked forespørsel over grensen uten Content-Length", async () => {
    let pushes = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pushes += 1;
        if (pushes > 100) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: stream,
      // Request setter normalt ikke Content-Length når body er en stream.
      duplex: "half",
    } as RequestInit);

    const result = await readRequestBodyWithLimit(request, 2048);

    expect(result).toEqual({ ok: false, reason: "too-large" });
    // Vi skal ha stoppet etter få biter, ikke lest alle 100.
    expect(pushes).toBeLessThan(10);
  });

  it("avviser tomme kropper", async () => {
    const request = new Request("http://localhost/upload", { method: "POST" });
    await expect(readRequestBodyWithLimit(request, 10)).resolves.toEqual({
      ok: false,
      reason: "empty",
    });
  });
});
