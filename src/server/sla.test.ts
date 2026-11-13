import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    slaClock: { findMany: vi.fn(), updateMany: vi.fn() },
    businessHours: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
  notifyWorkOrderEvent: vi.fn(async () => 0),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("./notifications", () => ({
  notifyWorkOrderEvent: mocks.notifyWorkOrderEvent,
}));

import { sweepSlaClocks } from "./sla";

const NOW = new Date("2026-11-13T09:00:00.000Z");

type ClockRow = {
  id: string;
  state: string;
  startedAt: Date;
  respondBy: Date;
  resolveBy: Date;
  respondedAt: Date | null;
  resolvedAt: Date | null;
  breachedAt: Date | null;
  policy: {
    name: string;
    responseMinutes: number;
    resolutionMinutes: number;
    businessHoursOnly: boolean;
    departmentId: string | null;
  };
  workOrder: { id: string; title: string; departmentId: string };
};

/** En klokke som er langt unna fristene, slik at sveipet ikke varsler. */
function clock(
  id: string,
  policyDepartmentId: string | null,
  workOrderDepartmentId: string,
): ClockRow {
  return {
    id,
    state: "ON_TRACK",
    startedAt: new Date(NOW.getTime() - 60 * 60_000),
    respondBy: new Date(NOW.getTime() + 8 * 60 * 60_000),
    resolveBy: new Date(NOW.getTime() + 9 * 60 * 60_000),
    respondedAt: null,
    resolvedAt: null,
    breachedAt: null,
    policy: {
      name: "Standard",
      responseMinutes: 480,
      resolutionMinutes: 540,
      businessHoursOnly: true,
      departmentId: policyDepartmentId,
    },
    workOrder: { id: `wo-${id}`, title: `Oppdrag ${id}`, departmentId: workOrderDepartmentId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.slaClock.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.businessHours.findMany.mockResolvedValue([]);
  mocks.prisma.holiday.findMany.mockResolvedValue([]);
  mocks.prisma.user.findMany.mockResolvedValue([]);
});

describe("SLA-sveipets kalenderbruk", () => {
  it("henter kalenderen én gang per avdeling per sveip", async () => {
    mocks.prisma.slaClock.findMany.mockResolvedValue([
      clock("1", "dep-a", "dep-a"),
      clock("2", "dep-a", "dep-a"),
      clock("3", "dep-a", "dep-a"),
      // Policy uten avdeling: kalenderen kommer fra oppdragets avdeling.
      clock("4", null, "dep-b"),
      clock("5", null, "dep-b"),
    ]);

    const result = await sweepSlaClocks(NOW);

    expect(result.checked).toBe(5);
    // To avdelinger gir to kalenderoppslag, ikke ett per klokke (10 før).
    expect(mocks.prisma.businessHours.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.holiday.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.businessHours.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { departmentId: "dep-a" } }),
    );
    expect(mocks.prisma.businessHours.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { departmentId: "dep-b" } }),
    );
  });

  it("holder kalenderoppslagene på to uansett hvor mange klokker sveipet ser", async () => {
    // 500 klokker i én avdeling: før ble kalenderen hentet per klokke, altså
    // 500 × 2 = 1000 spørringer. Nå er det to, uansett antall klokker.
    mocks.prisma.slaClock.findMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) =>
        clock(String(index), "dep-a", "dep-a"),
      ),
    );

    const result = await sweepSlaClocks(NOW);

    expect(result.checked).toBe(500);
    expect(mocks.prisma.businessHours.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.holiday.findMany).toHaveBeenCalledTimes(1);
  });

  it("deler ikke kalenderen mellom to sveip", async () => {
    mocks.prisma.slaClock.findMany.mockResolvedValue([
      clock("1", "dep-a", "dep-a"),
      clock("2", "dep-a", "dep-a"),
    ]);

    await sweepSlaClocks(NOW);
    // Endrede åpningstider skal slå gjennom i neste kjøring.
    mocks.prisma.businessHours.findMany.mockClear();
    mocks.prisma.holiday.findMany.mockClear();
    await sweepSlaClocks(NOW);

    expect(mocks.prisma.businessHours.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.holiday.findMany).toHaveBeenCalledTimes(1);
  });
});
