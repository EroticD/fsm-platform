import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  prisma: {
    upload: { aggregate: vi.fn(), create: vi.fn() },
    workOrder: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: () => true }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/upload-slot", () => ({
  MAX_REQUEST_BYTES: 2048,
  maxBytesForMime: () => 2048,
  withUploadSlot: async <T>(fn: () => Promise<T>) => fn(),
}));

import { POST } from "./route";

function user() {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
  };
}

function multipart(file: File): Request {
  const formData = new FormData();
  formData.set("file", file);
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
});

describe("POST /api/upload – innholdskontroll", () => {
  it("avviser en fil der magiske bytes ikke stemmer med deklarert type", async () => {
    const file = new File([new TextEncoder().encode("<html>ikke et bilde</html>")], "bilde.png", {
      type: "image/png",
    });

    const response = await POST(multipart(file));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("stemmer ikke"),
    });
    expect(mocks.prisma.upload.aggregate).not.toHaveBeenCalled();
  });

  it("avviser en chunked forespørsel over grensen før den bufres ferdig", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 20; index += 1) {
          controller.enqueue(new Uint8Array(1024));
        }
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      body: stream,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);

    const response = await POST(request);

    expect(response.status).toBe(413);
  });
});
