import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  saveDraft: vi.fn(),
  allowRequestDb: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/reports", () => ({ saveDraft: mocks.saveDraft }));
vi.mock("@/lib/rate-limit-db", () => ({ allowRequestDb: mocks.allowRequestDb }));

import { POST } from "./route";

const URL = "http://localhost:3000/api/offline/draft";

function request(body: BodyInit | ReadableStream<Uint8Array>, init: RequestInit = {}) {
  const { headers, ...rest } = init;
  const stream = body instanceof ReadableStream ? { duplex: "half" as const } : {};
  return new Request(URL, {
    method: "POST",
    ...rest,
    ...stream,
    headers: { origin: "http://localhost:3000", ...(headers ?? {}) },
    body,
  } as RequestInit);
}

function chunkedBody(totalBytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(64 * 1024).fill(97); // "a"
  let sent = 0;
  return new ReadableStream({
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "u1", role: "TECHNICIAN" });
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.saveDraft.mockResolvedValue({ ok: true, savedAt: "2026-01-01T00:00:00.000Z" });
});

describe("/api/offline/draft", () => {
  it("avviser 3 MB med 413 før kladden parses eller lagres", async () => {
    const body = JSON.stringify({ workOrderId: "wo1", notes: "a".repeat(3_000_000) });

    const response = await POST(
      request(body, { headers: { "content-length": String(body.length) } }),
    );

    expect(response.status).toBe(413);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Kladden er for stor" });
  });

  it("avviser en chunked kropp over 2 MB uten å parse den", async () => {
    const response = await POST(request(chunkedBody(3_000_000)));

    expect(response.status).toBe(413);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("godtar en gyldig kladd på nesten 2 MB", async () => {
    const body = JSON.stringify({
      workOrderId: "wo1",
      templateId: "tpl1",
      notes: "a".repeat(1_900_000),
    });
    expect(body.length).toBeLessThan(2_000_000);

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("avviser ugyldig JSON med 400", async () => {
    const response = await POST(request("ikke json"));

    expect(response.status).toBe(400);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
});
