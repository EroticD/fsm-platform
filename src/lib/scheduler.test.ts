import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recurring: vi.fn(async () => []),
  lifecycle: vi.fn(async () => ({ renewed: 0, expired: 0, generated: 0 })),
  maintenance: vi.fn(async () => []),
  warranty: vi.fn(async () => ({ checked: 0, notified: 0 })),
  sla: vi.fn(async () => ({
    checked: 0,
    atRisk: 0,
    breached: 0,
    met: 0,
    notified: 0,
  })),
  slaCleanup: vi.fn(async () => ({
    enabled: true,
    skipped: "not_due" as const,
    runId: null,
    result: null,
    error: null,
  })),
}));

vi.mock("@/lib/recurring", () => ({
  generateDueRecurringWorkOrders: mocks.recurring,
}));
vi.mock("@/server/maintenance", () => ({
  generateDueMaintenanceWorkOrders: mocks.maintenance,
}));
vi.mock("@/server/equipment", () => ({
  notifyWarrantyExpiring: mocks.warranty,
}));
vi.mock("@/server/contracts", () => ({
  runContractLifecycle: mocks.lifecycle,
}));
vi.mock("@/server/sla", () => ({ sweepSlaClocks: mocks.sla }));
vi.mock("@/server/sla-cleanup-job", () => ({
  runSlaCleanupJob: mocks.slaCleanup,
}));

import { runScheduledJobs } from "./scheduler";

describe("runScheduledJobs", () => {
  it("kaller den automatiske SLA-oppryddingen med samme tidspunkt", async () => {
    const now = new Date("2026-11-07T12:00:00.000Z");

    const result = await runScheduledJobs(now);

    expect(mocks.slaCleanup).toHaveBeenCalledWith({ now });
    expect(result.slaCleanup).toMatchObject({
      enabled: true,
      skipped: "not_due",
    });
  });
});
