import { describe, expect, it } from "vitest";
import {
  FORM_BODY_LIMIT,
  JSON_BODY_LIMIT,
  readFormDataWithLimit,
  readJsonWithLimit,
} from "./request-body";

function chunkedBody(totalBytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(16 * 1024).fill(97);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunk.byteLength, totalBytes - sent);
      controller.enqueue(chunk.slice(0, size));
      sent += size;
    },
  });
}

function post(body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  const stream = body instanceof ReadableStream ? { duplex: "half" as const } : {};
  return new Request("http://localhost/api/test", {
    method: "POST",
    body,
    ...stream,
    headers,
  } as RequestInit);
}

describe("readJsonWithLimit", () => {
  it("leser gyldig JSON uten Content-Length", async () => {
    const result = await readJsonWithLimit(post('{"ok":true}'));

    expect(result).toEqual({ ok: true, data: { ok: true } });
  });

  it("avviser Content-Length over grensen selv uten kropp", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        "content-length": String(JSON_BODY_LIMIT + 1),
        "content-type": "application/json",
      },
    });

    const result = await readJsonWithLimit(request);

    // Uten Content-Length-sjekken ville tom kropp gitt 400, ikke 413.
    expect(result).toMatchObject({ ok: false, status: 413, reason: "too-large" });
  });

  it("avviser en chunked kropp over grensen uten å parse den", async () => {
    const request = post(chunkedBody(JSON_BODY_LIMIT + 1024), {
      "content-type": "application/json",
    });

    const result = await readJsonWithLimit(request);

    expect(result).toMatchObject({ ok: false, status: 413, reason: "too-large" });
  });

  it("godtar en kropp på nøyaktig grensen", async () => {
    const body = JSON.stringify({ value: "a".repeat(JSON_BODY_LIMIT - 16) });
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(JSON_BODY_LIMIT);

    const result = await readJsonWithLimit(post(body, { "content-type": "application/json" }));

    expect(result.ok).toBe(true);
  });

  it("avviser ugyldig JSON og tom kropp med 400", async () => {
    await expect(readJsonWithLimit(post("ikke json"))).resolves.toMatchObject({
      ok: false,
      status: 400,
      reason: "invalid",
    });
    await expect(
      readJsonWithLimit(new Request("http://localhost/api/test", { method: "POST" })),
    ).resolves.toMatchObject({ ok: false, status: 400, reason: "invalid" });
  });
});

describe("readFormDataWithLimit", () => {
  it("leser et vanlig skjema", async () => {
    const formData = new FormData();
    formData.set("title", "Pumpe");
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: formData,
    });

    const result = await readFormDataWithLimit(request);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.get("title")).toBe("Pumpe");
  });

  it("avviser Content-Length over grensen", async () => {
    const request = post("a", {
      "content-length": String(FORM_BODY_LIMIT + 1),
      "content-type": "multipart/form-data; boundary=x",
    });

    const result = await readFormDataWithLimit(request);

    expect(result).toMatchObject({ ok: false, status: 413, reason: "too-large" });
  });

  it("avviser ukjent lengde når strømmen er for stor", async () => {
    const request = post(chunkedBody(FORM_BODY_LIMIT + 1024), {
      "content-type": "multipart/form-data; boundary=x",
    });

    const result = await readFormDataWithLimit(request);

    expect(result).toMatchObject({ ok: false, status: 413, reason: "too-large" });
  });

  it("avviser skjema uten Content-Type", async () => {
    const request = post("a");

    const result = await readFormDataWithLimit(request);

    expect(result).toMatchObject({ ok: false, status: 400, reason: "invalid" });
  });
});
