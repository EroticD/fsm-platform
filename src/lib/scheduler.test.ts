import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleEnabled: vi.fn(),
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

vi.mock("@/server/modules", () => ({ moduleEnabled: mocks.moduleEnabled }));
vi.mock("@/server/contracts", () => ({
  runContractLifecycle: mocks.lifecycle,
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
vi.mock("@/server/sla", () => ({ sweepSlaClocks: mocks.sla }));
vi.mock("@/server/sla-cleanup-job", () => ({
  runSlaCleanupJob: mocks.slaCleanup,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runScheduledJobs } from "./scheduler";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.moduleEnabled.mockResolvedValue(false);
  mocks.lifecycle.mockResolvedValue({ renewed: 0, expired: 0, generated: 0 });
  mocks.recurring.mockResolvedValue([]);
  mocks.maintenance.mockResolvedValue([]);
  mocks.warranty.mockResolvedValue({ checked: 0, notified: 0 });
  mocks.sla.mockResolvedValue({
    checked: 0,
    atRisk: 0,
    breached: 0,
    met: 0,
    notified: 0,
  });
  mocks.slaCleanup.mockResolvedValue({
    enabled: true,
    skipped: "not_due",
    runId: null,
    result: null,
    error: null,
  });
});

describe("planlagte jobber og moduler", () => {
  it("kjører ingen avtale-, SLA-, utstyrs- eller oppryddingsjobber når modulene er av", async () => {
    const result = await runScheduledJobs(new Date("2026-01-01T00:00:00Z"));

    expect(mocks.lifecycle).not.toHaveBeenCalled();
    expect(mocks.recurring).not.toHaveBeenCalled();
    expect(mocks.maintenance).not.toHaveBeenCalled();
    expect(mocks.warranty).not.toHaveBeenCalled();
    expect(mocks.sla).not.toHaveBeenCalled();
    expect(mocks.slaCleanup).not.toHaveBeenCalled();
    expect(result.sla).toEqual({
      checked: 0,
      atRisk: 0,
      breached: 0,
      met: 0,
      notified: 0,
    });
    expect(result.slaCleanup).toMatchObject({
      enabled: false,
      skipped: "disabled",
    });
  });

  it("kjører jobbene når modulene er på", async () => {
    mocks.moduleEnabled.mockResolvedValue(true);
    await runScheduledJobs(new Date("2026-01-01T00:00:00Z"));

    expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
    expect(mocks.recurring).toHaveBeenCalledTimes(1);
    expect(mocks.maintenance).toHaveBeenCalledTimes(1);
    expect(mocks.warranty).toHaveBeenCalledTimes(1);
    expect(mocks.sla).toHaveBeenCalledTimes(1);
    expect(mocks.slaCleanup).toHaveBeenCalledTimes(1);
  });

  it("kaller den automatiske SLA-oppryddingen med samme tidspunkt når avtaler er på", async () => {
    mocks.moduleEnabled.mockResolvedValue(true);
    const now = new Date("2026-11-07T12:00:00.000Z");

    const result = await runScheduledJobs(now);

    expect(mocks.slaCleanup).toHaveBeenCalledWith({ now });
    expect(result.slaCleanup).toMatchObject({
      enabled: true,
      skipped: "not_due",
    });
  });
});
