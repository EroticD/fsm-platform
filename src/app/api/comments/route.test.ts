import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(() => true),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  assertSameOrigin: vi.fn(() => true),
  workOrderFindFirst: vi.fn(async () => ({ id: "wo-1" })),
  commentCreate: vi.fn(async () => ({ id: "c1" })),
  auditCreate: vi.fn(async () => ({ id: "a1" })),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/access", () => ({ workOrderScope: () => ({}) }));
vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: { findFirst: mocks.workOrderFindFirst },
    comment: { create: mocks.commentCreate },
    auditLog: { create: mocks.auditCreate },
  },
}));

import { JSON_BODY_LIMIT } from "@/lib/request-body";
import { POST } from "./route";

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
  return new Request("http://localhost/api/comments", {
    method: "POST",
    body,
    ...stream,
    headers,
  } as RequestInit);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.hasPermission.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.assertSameOrigin.mockReturnValue(true);
});

describe("POST /api/comments – kroppsgrense", () => {
  it("avviser Content-Length over 64 KB før kommentaren parses", async () => {
    const response = await POST(
      request(JSON.stringify({ entityType: "workOrder", entityId: "wo-1", content: "hei" }), {
        "content-type": "application/json",
        "content-length": String(JSON_BODY_LIMIT + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.workOrderFindFirst).not.toHaveBeenCalled();
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it("avviser en chunked kropp over grensen uten Content-Length", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > JSON_BODY_LIMIT) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024));
        sent += 1024;
      },
    });

    const response = await POST(
      request(stream, { "content-type": "application/json" }),
    );

    expect(response.status).toBe(413);
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });

  it("avviser ugyldig JSON med 400", async () => {
    const response = await POST(
      request("ikke json", { "content-type": "application/json" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });
});
