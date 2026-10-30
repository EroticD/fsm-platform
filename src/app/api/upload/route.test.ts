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
import {
  MAX_CONCURRENT_UPLOAD_BODY_READS,
  UPLOAD_BODY_RETRY_AFTER_SECONDS,
  getUploadBodyGateState,
  tryAcquireUploadBodySlot,
} from "@/lib/upload-concurrency";

function user(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function multipart(
  file: File,
  fields: Record<string, string> = {},
): Request {
  const formData = new FormData();
  formData.set("file", file);
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: formData,
  });
}

function pdfFile() {
  return new File(
    [new TextEncoder().encode("%PDF-1.4\n")],
    "fil.pdf",
    { type: "application/pdf" },
  );
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
      error: "mime_mismatch",
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

describe("POST /api/upload – kroppskonkurranse", () => {
  it("svarer 503 med Retry-After når lesegrensen er nådd", async () => {
    const leases = Array.from(
      { length: MAX_CONCURRENT_UPLOAD_BODY_READS },
      () => tryAcquireUploadBodySlot(),
    );
    for (const lease of leases) expect(lease).not.toBeNull();

    try {
      const response = await POST(multipart(pdfFile()));

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe(
        String(UPLOAD_BODY_RETRY_AFTER_SECONDS),
      );
      await expect(response.json()).resolves.toMatchObject({
        error: "upload_busy",
      });
    } finally {
      for (const lease of leases) lease?.release();
    }
  });

  it("frigir leseplassen også når filen avvises", async () => {
    const file = new File(
      [new TextEncoder().encode("<html>ikke et bilde</html>")],
      "bilde.png",
      { type: "image/png" },
    );

    const response = await POST(multipart(file));

    expect(response.status).toBe(415);
    expect(getUploadBodyGateState().active).toBe(0);
  });
});

describe("POST /api/upload – låst oppdrag", () => {
  function workOrder(overrides: Record<string, unknown> = {}) {
    return {
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "OPEN",
      legalHold: false,
      department: { isActive: true },
      ...overrides,
    };
  }

  function uploadToWorkOrder() {
    return POST(multipart(pdfFile(), { workOrderId: "wo1" }));
  }

  it.each(["COMPLETED", "CANCELLED"])(
    "avviser opplasting til et %s-oppdrag, også for administrator",
    async (status) => {
      mocks.prisma.workOrder.findFirst.mockResolvedValue(
        workOrder({ status }),
      );

      const response = await uploadToWorkOrder();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "work_order_locked",
      });
      expect(mocks.prisma.upload.aggregate).not.toHaveBeenCalled();
    },
  );

  it("avviser opplasting til et oppdrag med bevaringsplikt", async () => {
    mocks.getCurrentUser.mockResolvedValue(user({ role: "OFFICE" }));
    mocks.prisma.workOrder.findFirst.mockResolvedValue(
      workOrder({ legalHold: true }),
    );

    const response = await uploadToWorkOrder();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "legal_hold",
    });
    expect(mocks.prisma.upload.aggregate).not.toHaveBeenCalled();
  });

  it("avviser opplasting til en deaktivert avdeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(
      workOrder({ department: { isActive: false } }),
    );

    const response = await uploadToWorkOrder();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "department_inactive",
    });
    expect(mocks.prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          status: true,
          legalHold: true,
          department: { select: { isActive: true } },
        }),
      }),
    );
    expect(mocks.prisma.upload.aggregate).not.toHaveBeenCalled();
  });
});
