import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(() => true),
  assertSameOrigin: vi.fn(() => true),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  updateWorkOrderDate: vi.fn(
    async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
  ),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/work-orders", () => ({
  updateWorkOrderDate: mocks.updateWorkOrderDate,
}));

import { JSON_BODY_LIMIT } from "@/lib/request-body";
import { PATCH } from "./route";

const params = { params: Promise.resolve({ id: "wo-1" }) };

function user() {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
  };
}

function request(body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  const stream = body instanceof ReadableStream ? { duplex: "half" as const } : {};
  return new Request("http://localhost/api/oppdrag/wo-1/date", {
    method: "PATCH",
    body,
    ...stream,
    headers,
  } as RequestInit);
}

function chunkedBody(totalBytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(1024));
      sent += 1024;
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.hasPermission.mockReturnValue(true);
  mocks.assertSameOrigin.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.updateWorkOrderDate.mockResolvedValue({ ok: true });
});

describe("PATCH /api/oppdrag/[id]/date", () => {
  it("sender den parsede kroppen videre", async () => {
    const response = await PATCH(
      request(JSON.stringify({ scheduledFor: "2026-01-02" }), {
        "content-type": "application/json",
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.updateWorkOrderDate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "wo-1",
      { scheduledFor: "2026-01-02" },
    );
  });

  it("oversetter bevaringsplikt til 403", async () => {
    mocks.updateWorkOrderDate.mockResolvedValue({
      ok: false,
      error: "legal-hold",
    });

    const response = await PATCH(
      request(JSON.stringify({ newDate: "2026-01-02" }), {
        "content-type": "application/json",
      }),
      params,
    );

    expect(response?.status).toBe(403);
  });

  it("avviser Content-Length over 64 KB før parsing", async () => {    const response = await PATCH(
      request("{}", {
        "content-type": "application/json",
        "content-length": String(JSON_BODY_LIMIT + 1),
      }),
      params,
    );

    expect(response.status).toBe(413);
    expect(mocks.updateWorkOrderDate).not.toHaveBeenCalled();
  });

  it("avviser en chunked kropp over grensen uten Content-Length", async () => {
    const response = await PATCH(
      request(chunkedBody(JSON_BODY_LIMIT + 1024), {
        "content-type": "application/json",
      }),
      params,
    );

    expect(response.status).toBe(413);
    expect(mocks.updateWorkOrderDate).not.toHaveBeenCalled();
  });

  it("rate-limiter før kroppen leses", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 9,
    });

    const response = await PATCH(
      request(chunkedBody(JSON_BODY_LIMIT * 2), {
        "content-type": "application/json",
      }),
      params,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("9");
    expect(mocks.updateWorkOrderDate).not.toHaveBeenCalled();
  });
});
