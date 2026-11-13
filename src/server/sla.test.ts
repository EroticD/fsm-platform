import { beforeEach, describe, expect, it, vi } from "vitest";

type NotifyUserInput = {
  userId: string;
  type: string;
  title: string;
  body: string | null;
  href?: string | null;
  sourceLabel?: string | null;
  dedupeKey?: string | null;
};

const mocks = vi.hoisted(() => ({
  prisma: {
    slaClock: { findMany: vi.fn(), updateMany: vi.fn() },
    businessHours: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    workOrder: { findUnique: vi.fn() },
  },
  notifyUser: vi.fn<(input: NotifyUserInput) => Promise<{ id: string } | null>>(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("./notifications", () => ({ notifyUser: mocks.notifyUser }));

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
  mocks.prisma.workOrder.findUnique.mockResolvedValue(null);
  mocks.notifyUser.mockResolvedValue({ id: "notification-1" });
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

type WorkOrderRow = {
  id: string;
  title: string;
  departmentId: string;
  customer: { name: string | null } | null;
  technicians: { id: string }[];
};

function workOrderRow(id: string, departmentId: string): WorkOrderRow {
  return {
    id,
    title: `Sak ${id}`,
    departmentId,
    customer: { name: `Kunde ${id}` },
    technicians: [{ id: `tech-${id}` }],
  };
}

/**
 * En klokke som står som ON_TRACK, men der fristene allerede er passert.
 * Sveipet regner den om til BREACHED, altså en tilstandsendring som varsler.
 * `businessHoursOnly: false` gjør fristene til ren minuttaritmetikk.
 */
function breachingClock(
  id: string,
  workOrderId: string,
  departmentId: string,
): ClockRow {
  return {
    id,
    state: "ON_TRACK",
    startedAt: new Date(NOW.getTime() - 20 * 60 * 60_000),
    respondBy: new Date(NOW.getTime() + 60 * 60_000),
    resolveBy: new Date(NOW.getTime() + 2 * 60 * 60_000),
    respondedAt: null,
    resolvedAt: null,
    breachedAt: null,
    policy: {
      name: "Standard",
      responseMinutes: 480,
      resolutionMinutes: 540,
      businessHoursOnly: false,
      departmentId,
    },
    workOrder: {
      id: workOrderId,
      title: `Sak ${workOrderId}`,
      departmentId,
    },
  };
}

/** Oppdrag 0–2 ligger i dep-a, oppdrag 3–4 i dep-b. */
const WORK_ORDER_IDS = ["wo-0", "wo-1", "wo-2", "wo-3", "wo-4"];

function departmentForWorkOrder(workOrderId: string): string {
  return WORK_ORDER_IDS.indexOf(workOrderId) < 3 ? "dep-a" : "dep-b";
}

describe("SLA-sveipets varseloppslag", () => {
  it("slår opp oppdraget og avdelingens mottakere én gang per sveip", async () => {
    // 50 klokker på 5 oppdrag i 2 avdelinger. Uten cache ble oppdraget og
    // kontorbrukerne hentet på nytt for hver klokke: 50 + 50 oppslag.
    mocks.prisma.slaClock.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => {
        const workOrderId = WORK_ORDER_IDS[index % WORK_ORDER_IDS.length];
        return breachingClock(
          `c${index}`,
          workOrderId,
          departmentForWorkOrder(workOrderId),
        );
      }),
    );
    mocks.prisma.workOrder.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        const departmentId = departmentForWorkOrder(where.id);
        return WORK_ORDER_IDS.includes(where.id)
          ? workOrderRow(where.id, departmentId)
          : null;
      },
    );
    mocks.prisma.user.findMany.mockImplementation(
      async ({ where }: { where: { departmentId: string } }) =>
        where.departmentId === "dep-a"
          ? [{ id: "office-a1" }, { id: "office-a2" }]
          : [{ id: "office-b1" }],
    );

    const result = await sweepSlaClocks(NOW);

    expect(result.checked).toBe(50);
    // Ett oppslag per oppdrag og ett per avdeling – ikke ett per klokke.
    expect(mocks.prisma.workOrder.findUnique).toHaveBeenCalledTimes(5);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: "dep-a",
          role: { in: ["ADMIN", "OFFICE"] },
          isActive: true,
        },
      }),
    );

    // 30 klokker i dep-a (tekniker + 2 på kontoret) og 20 i dep-b
    // (tekniker + 1 på kontoret) = 130 varsler, uendret fra før cachen.
    expect(mocks.notifyUser).toHaveBeenCalledTimes(130);
    expect(result.notified).toBe(130);

    // Samme tekst, kanal og dedupe som før: nøkkelen får bruker-id-en på
    // samme måte som `deliverWorkOrderNotification` gjorde.
    const firstCall = mocks.notifyUser.mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({
      type: "SLA_BREACHED",
      title: "SLA-fristen er brutt",
      href: "/oppdrag/wo-0",
      sourceLabel: "Oppdrag: Sak wo-0 · Kunde wo-0",
      dedupeKey: "sla:breached:c0:tech-wo-0",
    });
    expect(firstCall?.body).toBe(
      "Oppdraget «Sak wo-0» har brutt svartiden (Standard).",
    );

    // Cachen lever bare så lenge sveipet gjør: en ny kjøring slår opp på nytt,
    // slik at endret tittel eller nye kontoransatte slår gjennom.
    mocks.prisma.workOrder.findUnique.mockClear();
    mocks.prisma.user.findMany.mockClear();
    await sweepSlaClocks(NOW);

    expect(mocks.prisma.workOrder.findUnique).toHaveBeenCalledTimes(5);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledTimes(2);
  });

  it("lar resten av sveipet gå videre når ett oppslag feiler", async () => {
    mocks.prisma.slaClock.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) =>
        breachingClock(`c${index}`, `wo-${index % 2}`, "dep-a"),
      ),
    );
    mocks.prisma.workOrder.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === "wo-0") throw new Error("databasen svarte ikke");
        return workOrderRow("wo-1", "dep-a");
      },
    );
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "office-a1" }]);

    const result = await sweepSlaClocks(NOW);

    // Sveipet fullfører, og den feilede oppslaget bufres: det prøves én gang,
    // ikke på nytt for hver av de fem klokkene på samme oppdrag.
    expect(result.checked).toBe(10);
    expect(result.breached).toBe(10);
    expect(mocks.prisma.workOrder.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledTimes(1);
    // Bare oppdraget som lot seg slå opp, gir varsel: tekniker + kontor × 5.
    expect(mocks.notifyUser).toHaveBeenCalledTimes(10);
    expect(result.notified).toBe(10);
  });

  it("varsler ikke når klokken ikke bytter tilstand", async () => {
    // Allerede BREACHED: sveipet oppdaterer tidspunktene, men varsler ikke.
    mocks.prisma.slaClock.findMany.mockResolvedValue([
      { ...breachingClock("c1", "wo-0", "dep-a"), state: "BREACHED" },
    ]);

    const result = await sweepSlaClocks(NOW);

    expect(result.checked).toBe(1);
    expect(result.breached).toBe(1);
    expect(result.notified).toBe(0);
    // Ingen varsling betyr ingen mottakeroppslag i det hele tatt.
    expect(mocks.prisma.workOrder.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled();
    expect(mocks.notifyUser).not.toHaveBeenCalled();
  });
});

