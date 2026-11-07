import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findJob: vi.fn(),
  findUpload: vi.fn(),
  deleteUpload: vi.fn(),
  isReferenced: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    customerTransferJob: { findUnique: mocks.findJob },
    upload: {
      findFirst: mocks.findUpload,
      deleteMany: mocks.deleteUpload,
    },
  },
}));

vi.mock("@/lib/upload-cleanup", () => ({
  isUploadReferenced: mocks.isReferenced,
}));

import {
  FINAL_FILES_LEDGER,
  reconcileTransferFiles,
  writeFinalFilesLedger,
} from "./reconcile";

const ORPHAN = "11111111-1111-4111-8111-111111111111.pdf";
const REFERENCED = "22222222-2222-4222-8222-222222222222.png";
let root = "";

describe("avstemming av kundeoverføringsfiler", () => {
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-transfer-reconcile-"));
    process.env.UPLOAD_DIR = root;
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.rm(path.join(root, ".transfer"), { recursive: true, force: true });
    mocks.deleteUpload.mockResolvedValue({ count: 1 });
    mocks.findUpload.mockResolvedValue(null);
    mocks.isReferenced.mockImplementation(
      async (url: string) => url.endsWith(REFERENCED),
    );
  });

  it("sletter bare journalførte filer uten database-referanse", async () => {
    await fs.writeFile(path.join(root, ORPHAN), "orphan");
    await fs.writeFile(path.join(root, REFERENCED), "referenced");
    mocks.findJob.mockResolvedValue({
      status: "FAILED",
      updatedAt: new Date(),
    });

    const jobId = "job-reconcile-1";
    await writeFinalFilesLedger(jobId, [ORPHAN, REFERENCED]);
    const result = await reconcileTransferFiles();

    expect(result.filesDeleted).toBe(1);
    expect(result.filesKept).toBe(1);
    await expect(fs.access(path.join(root, ORPHAN))).rejects.toBeTruthy();
    await expect(fs.access(path.join(root, REFERENCED))).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(root, ".transfer", jobId, FINAL_FILES_LEDGER),
      ),
    ).rejects.toBeTruthy();
  });

  it("rører ikke en aktiv jobb som fortsatt skriver filer", async () => {
    await fs.writeFile(path.join(root, ORPHAN), "orphan");
    mocks.findJob.mockResolvedValue({
      status: "RUNNING",
      updatedAt: new Date(),
    });
    const jobId = "job-reconcile-2";
    await writeFinalFilesLedger(jobId, [ORPHAN]);
    const result = await reconcileTransferFiles({ staleMs: 60_000 });

    expect(result.jobs).toBe(0);
    await expect(fs.access(path.join(root, ORPHAN))).resolves.toBeUndefined();
  });

  it("tar over en gammel RUNNING-jobb og sletter bare u refererte filer", async () => {
    await fs.writeFile(path.join(root, ORPHAN), "orphan");
    mocks.findJob.mockResolvedValue({
      status: "RUNNING",
      updatedAt: new Date(Date.now() - 2 * 60 * 60_000),
    });
    const jobId = "job-reconcile-3";
    await writeFinalFilesLedger(jobId, [ORPHAN]);
    const result = await reconcileTransferFiles({ staleMs: 60_000 });
    expect(result.filesDeleted).toBe(1);
  });

  it("ignorerer utrygge navn i fillisten", async () => {
    const jobId = "job-reconcile-4";
    const dir = path.join(root, ".transfer", jobId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, FINAL_FILES_LEDGER),
      JSON.stringify({
        version: 1,
        files: ["../../etc/passwd", "/etc/passwd", ORPHAN],
      }),
    );
    mocks.findJob.mockResolvedValue({ status: "FAILED", updatedAt: new Date() });
    await reconcileTransferFiles();
    // Det utrygge navnet ble forkastet, men det gyldige navnet ble behandlet.
    expect(mocks.isReferenced).toHaveBeenCalledTimes(1);
  });
});
