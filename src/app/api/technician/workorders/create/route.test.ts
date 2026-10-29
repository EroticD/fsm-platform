import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(() => true),
  assertSameOrigin: vi.fn(() => true),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  createWorkOrder: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/work-orders", () => ({
  createWorkOrder: mocks.createWorkOrder,
}));

import { FORM_BODY_LIMIT } from "@/lib/request-body";
import { POST } from "./route";

function user() {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "TECHNICIAN",
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
  return new Request("http://localhost/api/technician/workorders/create", {
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
  mocks.assertSameOrigin.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.createWorkOrder.mockResolvedValue({ ok: true });
});

describe("POST /api/technician/workorders/create – kroppsgrense", () => {
  it("avviser Content-Length over 1 MB og sender brukeren tilbake til skjemaet", async () => {
    const response = await POST(
      request("a", {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(FORM_BODY_LIMIT + 1),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=ugyldig-data");
    expect(mocks.createWorkOrder).not.toHaveBeenCalled();
  });

  it("avviser en chunked kropp over grensen uten Content-Length", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > FORM_BODY_LIMIT) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(64 * 1024));
        sent += 64 * 1024;
      },
    });

    const response = await POST(
      request(stream, { "content-type": "multipart/form-data; boundary=x" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=ugyldig-data");
    expect(mocks.createWorkOrder).not.toHaveBeenCalled();
  });
});
