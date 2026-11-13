import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleEnabled: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  logger: mocks.log,
}));

import {
  createRunGate,
  jitteredIntervalMs,
  runScheduledJobs,
  startScheduler,
  stopScheduler,
  SCHEDULER_JITTER_RATIO,
} from "./scheduler";

type SchedulerGlobalFlag = typeof globalThis & {
  __fsmSchedulerStarted?: boolean;
  __fsmSchedulerStop?: () => Promise<void>;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  const scope = globalThis as SchedulerGlobalFlag;
  delete scope.__fsmSchedulerStarted;
  delete scope.__fsmSchedulerStop;
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

describe("jitter og overlappsvakt", () => {
  const sixHours = 6 * 60 * 60 * 1000;

  it("holder jitteren innenfor ±10 % av intervallet", () => {
    for (let i = 0; i < 500; i += 1) {
      const delay = jitteredIntervalMs(sixHours);
      expect(delay).toBeGreaterThanOrEqual(
        sixHours * (1 - SCHEDULER_JITTER_RATIO),
      );
      expect(delay).toBeLessThanOrEqual(
        sixHours * (1 + SCHEDULER_JITTER_RATIO),
      );
    }

    // Deterministiske ytterpunkter: random() = 0 gir maks negativt avvik.
    expect(jitteredIntervalMs(sixHours, () => 0)).toBe(sixHours * 0.9);
    expect(jitteredIntervalMs(sixHours, () => 0.999_999)).toBeLessThanOrEqual(
      sixHours * 1.1,
    );
    // Skalerer ikke under et millisekund – da finnes det ikke rom for avvik.
    expect(jitteredIntervalMs(0)).toBe(0);
  });

  it("slipper bare gjennom én kjøring om gangen og varsler ved overhopp", () => {
    const onSkip = vi.fn();
    const gate = createRunGate(onSkip);

    expect(gate.tryStart()).toBe(true);
    expect(gate.isActive()).toBe(true);
    expect(gate.tryStart()).toBe(false);
    expect(onSkip).toHaveBeenCalledTimes(1);

    gate.finish();
    expect(gate.isActive()).toBe(false);
    expect(gate.tryStart()).toBe(true);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("hopper over og logger når timeren fyrer mens forrige kjøring fortsatt pågår", async () => {
    vi.useFakeTimers();
    try {
      mocks.moduleEnabled.mockResolvedValue(true);
      let release: () => void = () => {};
      mocks.maintenance.mockImplementation(
        () =>
          new Promise<never[]>((resolve) => {
            release = () => resolve([]);
          }),
      );

      startScheduler();

      // Første kjøring er uten jitter: fast startforsinkelse på 10 s.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.maintenance).toHaveBeenCalledTimes(1);

      // Neste timervarsel kommer innenfor 6 t ± 10 %, mens kjøringen henger.
      await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
      expect(mocks.maintenance).toHaveBeenCalledTimes(1);
      expect(mocks.log.warn).toHaveBeenCalledWith(
        "scheduler: previous run still in progress, skipping",
        expect.objectContaining({ intervalMs: sixHours }),
      );

      release();
      await vi.advanceTimersByTimeAsync(0);
      await stopScheduler();
    } finally {
      vi.useRealTimers();
    }
  });
});
