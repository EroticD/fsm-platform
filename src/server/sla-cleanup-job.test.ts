import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    slaCleanupRun: {
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("./sla-cleanup", () => ({
  cancelUncontractedSlaClocks: mocks.cancel,
}));

import { runSlaCleanupJob, type SlaCleanupJobClient } from "./sla-cleanup-job";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const RESULT = {
  dryRun: false,
  scanned: 5,
  kept: 3,
  candidates: [],
  cancelled: 2,
};

function transactionClient() {
  return {
    $executeRaw: vi.fn(async () => 1),
    slaCleanupRun: {
      findFirst: mocks.findFirst,
      create: mocks.create,
    },
  };
}

function client(): SlaCleanupJobClient {
  return {
    $transaction: mocks.transaction,
    $executeRaw: vi.fn(async () => 1),
    slaCleanupRun: {
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
    },
  } as unknown as SlaCleanupJobClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) =>
      callback(transactionClient()),
  );
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "run-1" });
  mocks.update.mockResolvedValue({ id: "run-1" });
  mocks.cancel.mockResolvedValue(RESULT);
});

describe("runSlaCleanupJob", () => {
  it("gjør ingenting når SLA_CLEANUP_ENABLED er slått av", async () => {
    const result = await runSlaCleanupJob({
      now: NOW,
      env: { SLA_CLEANUP_ENABLED: "false" },
      client: client(),
    });

    expect(result).toMatchObject({
      enabled: false,
      skipped: "disabled",
      runId: null,
      result: null,
      error: null,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("hopper over når intervallet ikke er passert", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "run-old",
      startedAt: new Date(NOW.getTime() - 60 * 60_000),
      status: "SUCCEEDED",
    });

    const result = await runSlaCleanupJob({
      now: NOW,
      env: { SLA_CLEANUP_INTERVAL_HOURS: "6" },
      client: client(),
    });

    expect(result).toMatchObject({
      enabled: true,
      skipped: "not_due",
      runId: null,
      error: null,
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("kjører oppryddingen og lagrer resultatet på kjøringsraden", async () => {
    const result = await runSlaCleanupJob({
      now: NOW,
      env: { SLA_CLEANUP_INTERVAL_HOURS: "6" },
      client: client(),
    });

    expect(result).toMatchObject({
      enabled: true,
      skipped: null,
      runId: "run-1",
      result: RESULT,
      error: null,
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { startedAt: NOW, status: "RUNNING" },
      select: { id: true },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        status: "SUCCEEDED",
        finishedAt: expect.any(Date),
        scanned: 5,
        kept: 3,
        cancelled: 2,
      },
    });
  });

  it("lagrer feil og kaster ikke videre når oppryddingen feiler", async () => {
    mocks.cancel.mockRejectedValue(new Error("databasen svarte ikke"));

    await expect(
      runSlaCleanupJob({
        now: NOW,
        env: { SLA_CLEANUP_INTERVAL_HOURS: "6" },
        client: client(),
      }),
    ).resolves.toMatchObject({
      enabled: true,
      skipped: null,
      runId: "run-1",
      result: null,
      error: "databasen svarte ikke",
    });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        status: "FAILED",
        finishedAt: expect.any(Date),
        error: "databasen svarte ikke",
      },
    });
  });
});
