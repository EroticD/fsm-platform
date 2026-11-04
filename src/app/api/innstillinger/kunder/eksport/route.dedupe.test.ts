import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  findReusableExport: vi.fn(),
  exportCustomerPackage: vi.fn(),
  allowRequestDb: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getCurrentUser: () => mocks.getCurrentUser(),
}));

vi.mock("@/server/customer-transfer", () => ({
  findReusableExport: (...args: unknown[]) => mocks.findReusableExport(...args),
  exportCustomerPackage: (...args: unknown[]) =>
    mocks.exportCustomerPackage(...args),
}));

vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: (...args: unknown[]) => mocks.allowRequestDb(...args),
}));

import { POST as exportPost } from "./route";

const admin = {
  id: "admin-1",
  name: "Test",
  email: "test@example.test",
  role: "ADMIN",
  departmentId: null,
  isActive: true,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: { permissions: [] },
};

const job = {
  id: "job-1",
  kind: "EXPORT",
  status: "READY",
  checksumPrefix: "abc",
  schemaVersion: "1.0",
  sourceInstanceId: "instance",
  counts: {},
  errors: null,
  result: {},
  progressStage: "ready",
  progressProcessed: 1,
  progressTotal: 1,
  createdAt: "2026-11-04T00:00:00.000Z",
  completedAt: "2026-11-04T00:00:01.000Z",
  expiresAt: "2026-11-05T00:00:01.000Z",
  downloadUrl: "/api/innstillinger/kunder/eksport/job-1/download",
  fileName: "export.zip",
  reused: false,
};

function request(body: unknown = { customerIds: ["c1"] }) {
  return new Request("http://localhost/api/innstillinger/kunder/eksport", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("eksportrute: idempotens og rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(admin);
    mocks.findReusableExport.mockResolvedValue({ ok: true, data: null });
    mocks.allowRequestDb.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    mocks.exportCustomerPackage.mockResolvedValue({ ok: true, data: job });
  });

  it("returnerer nylig jobb før telleren uten å opprette en ny", async () => {
    mocks.findReusableExport.mockResolvedValue({
      ok: true,
      data: { ...job, reused: true },
    });

    const response = await exportPost(request() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "job-1" });
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
    expect(mocks.exportCustomerPackage).not.toHaveBeenCalled();
  });

  it("teller første eksport og bruker 10 i timen med versjonert nøkkel", async () => {
    const response = await exportPost(request() as never);

    expect(response.status).toBe(201);
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "customer-transfer-export:v2:admin-1",
      10,
      60 * 60 * 1000,
    );
    expect(mocks.exportCustomerPackage).toHaveBeenCalledTimes(1);
  });

  it("gir 429 med Retry-After og sekunder i kroppen når grensen er nådd", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 1234,
    });

    const response = await exportPost(request() as never);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1234");
    await expect(response.json()).resolves.toMatchObject({
      error: "customer_transfer.rate_limited",
      messageKey: "errors.customerTransfer.rateLimited",
      retryAfterSeconds: 1234,
    });
    expect(mocks.exportCustomerPackage).not.toHaveBeenCalled();
  });

  it("svarer 200 når tjenesten vant kappløpet og gjenbrukte jobben", async () => {
    mocks.exportCustomerPackage.mockResolvedValue({
      ok: true,
      data: { ...job, reused: true },
    });

    const response = await exportPost(request() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "job-1",
      reused: true,
    });
  });
});
