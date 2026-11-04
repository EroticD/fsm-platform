import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  buildCustomerPackage: vi.fn(),
  claimExportJob: vi.fn(),
  findReusableExportJob: vi.fn(),
  findJobForActor: vi.fn(),
  removeJobStaging: vi.fn(),
  writeStagedPackage: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    customerTransferJob: { update: mocks.update },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/customer-transfer/build-package", () => ({
  buildCustomerPackage: (...args: unknown[]) =>
    mocks.buildCustomerPackage(...args),
}));

vi.mock("@/lib/customer-transfer/jobs", () => ({
  abortJob: vi.fn(),
  claimExportJob: (...args: unknown[]) => mocks.claimExportJob(...args),
  cleanupExpiredTransfers: vi.fn(),
  createTransferJob: vi.fn(),
  findJobForActor: (...args: unknown[]) => mocks.findJobForActor(...args),
  findReusableExportJob: (...args: unknown[]) =>
    mocks.findReusableExportJob(...args),
  isJobExpired: vi.fn(() => false),
  previewToken: vi.fn(),
  previewTokenValid: vi.fn(),
  readStagedPackage: vi.fn(),
  removeJobStaging: (...args: unknown[]) => mocks.removeJobStaging(...args),
  writeStagedPackage: (...args: unknown[]) => mocks.writeStagedPackage(...args),
}));

import {
  exportCustomerPackage,
  findReusableExport,
} from "@/server/customer-transfer";

const actor = {
  id: "admin-1",
  name: "Test",
  email: "test@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: { permissions: [] },
};

const pendingJob = {
  id: "job-1",
  actorId: "admin-1",
  kind: "EXPORT",
  status: "PENDING",
  packageChecksum: null,
  sourceInstanceId: null,
  schemaVersion: null,
  customerIdsJson: ["c1"],
  countsJson: null,
  errorJson: null,
  resultJson: { requestFingerprint: "fp" },
  progressStage: null,
  progressProcessed: 0,
  progressTotal: 0,
  previewTokenHash: null,
  previewExpiresAt: null,
  targetFingerprint: null,
  stagingPath: null,
  expiresAt: new Date(Date.now() + 86_400_000),
  createdAt: new Date(),
  startedAt: null,
  completedAt: null,
  updatedAt: new Date(),
};

const readyJob = {
  ...pendingJob,
  status: "READY",
  packageChecksum: "a".repeat(64),
  progressStage: "ready",
  completedAt: new Date(),
};

describe("exportCustomerPackage: synlig feil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.claimExportJob.mockResolvedValue({
      job: pendingJob,
      reused: false,
    });
    mocks.removeJobStaging.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue(undefined);
  });

  it("returnerer stabil eksportfeilkode og lagrer den på jobben", async () => {
    mocks.buildCustomerPackage.mockRejectedValue(new Error("disk full"));

    const result = await exportCustomerPackage(actor, {
      customerIds: ["c1"],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      code: "customer_transfer.export_failed",
      messageKey: "errors.customerTransfer.exportFailed",
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({
          status: "FAILED",
          errorJson: {
            code: "customer_transfer.export_failed",
            messageKey: "errors.customerTransfer.exportFailed",
            stage: "build",
          },
        }),
      }),
    );
  });

  it("gjenbruker en READY-jobb uten å bygge på nytt", async () => {
    mocks.findReusableExportJob.mockResolvedValue(readyJob);

    const result = await findReusableExport(actor, { customerIds: ["c1"] });

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: "job-1",
        reused: true,
        downloadUrl: "/api/innstillinger/kunder/eksport/job-1/download",
      },
    });
    expect(mocks.buildCustomerPackage).not.toHaveBeenCalled();
  });
});
