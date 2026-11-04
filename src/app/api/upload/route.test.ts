import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  MAX_REQUEST_BYTES: 8 * 1024,
  maxBytesForMime: () => 8 * 1024,
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

let uploadRoot: string | null = null;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.prisma.upload.aggregate.mockResolvedValue({ _sum: { size: 0 } });
  mocks.prisma.upload.create.mockResolvedValue({ id: "upload-1" });
});

afterEach(async () => {
  if (uploadRoot) {
    await fs.rm(uploadRoot, { recursive: true, force: true });
    uploadRoot = null;
  }
  delete process.env.UPLOAD_DIR;
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
        for (let index = 0; index < 100; index += 1) {
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

describe("POST /api/upload – strømming og kvote", () => {
  it("strømmer en gyldig PDF til disk uten midlertidige rester", async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-upload-route-"));
    process.env.UPLOAD_DIR = uploadRoot;

    const response = await POST(multipart(pdfFile()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      fileType: "application/pdf",
    });
    const stored = await fs.readdir(uploadRoot);
    expect(stored.filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
    const tempEntries = await fs
      .readdir(path.join(uploadRoot, ".tmp"))
      .catch(() => []);
    expect(tempEntries).toEqual([]);
  });

  it("tar imot nettleserens FormData med en ekte fil når standardkvoten gjelder", async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-upload-route-"));
    process.env.UPLOAD_DIR = uploadRoot;

    // En realistisk rapport-PDF er større enn den gamle, feilaktige
    // standardkvoten på 2 KiB. Ruten skal bruke kvotene i bytes (2 GiB).
    const file = new File(
      [Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4096)])],
      "rapport.pdf",
      { type: "application/pdf" },
    );

    const response = await POST(multipart(file, { purpose: "document" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      fileType: "application/pdf",
    });
    const stored = await fs.readdir(uploadRoot);
    expect(stored.filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
  });

  it("svarer 507 når brukerkvoten er brukt opp", async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-upload-route-"));
    process.env.UPLOAD_DIR = uploadRoot;
    mocks.prisma.upload.aggregate.mockResolvedValue({
      _sum: { size: 2 * 1024 * 1024 * 1024 },
    });

    const response = await POST(multipart(pdfFile()));

    expect(response.status).toBe(507);
    await expect(response.json()).resolves.toMatchObject({
      error: "storage_quota_exceeded",
    });
    expect(mocks.prisma.upload.create).not.toHaveBeenCalled();
    const tempEntries = await fs
      .readdir(path.join(uploadRoot, ".tmp"))
      .catch(() => []);
    expect(tempEntries).toEqual([]);
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
