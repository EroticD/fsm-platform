import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleEnabled: vi.fn(),
  lifecycle: vi.fn(),
  recurring: vi.fn(),
  maintenance: vi.fn(),
  warranty: vi.fn(),
  sla: vi.fn(),
}));

vi.mock("@/server/modules", () => ({ moduleEnabled: mocks.moduleEnabled }));
vi.mock("@/server/contracts", () => ({ runContractLifecycle: mocks.lifecycle }));
vi.mock("@/lib/recurring", () => ({
  generateDueRecurringWorkOrders: mocks.recurring,
}));
vi.mock("@/server/maintenance", () => ({
  generateDueMaintenanceWorkOrders: mocks.maintenance,
}));
vi.mock("@/server/equipment", () => ({ notifyWarrantyExpiring: mocks.warranty }));
vi.mock("@/server/sla", () => ({ sweepSlaClocks: mocks.sla }));
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
});

describe("planlagte jobber og moduler", () => {
  it("kjører ingen avtale-, SLA- eller utstyrsjobber når modulene er av", async () => {
    const result = await runScheduledJobs(new Date("2026-01-01T00:00:00Z"));

    expect(mocks.lifecycle).not.toHaveBeenCalled();
    expect(mocks.recurring).not.toHaveBeenCalled();
    expect(mocks.maintenance).not.toHaveBeenCalled();
    expect(mocks.warranty).not.toHaveBeenCalled();
    expect(mocks.sla).not.toHaveBeenCalled();
    expect(result.sla).toEqual({
      checked: 0,
      atRisk: 0,
      breached: 0,
      met: 0,
      notified: 0,
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
  });
});
