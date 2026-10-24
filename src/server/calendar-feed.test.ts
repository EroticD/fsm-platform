import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    workOrder: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  getCalendarFeed,
  getOrCreateCalendarToken,
  revokeCalendarToken,
} from "./calendar-feed";

const actor: ServiceActor = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-a",
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.user.findUnique.mockResolvedValue(null);
  mocks.prisma.user.update.mockResolvedValue({});
  mocks.prisma.workOrder.findMany.mockResolvedValue([]);
});

describe("kalenderfeed", () => {
  it("gjenbruker eksisterende token", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ calendarToken: "a".repeat(64) });
    const result = await getOrCreateCalendarToken(actor);
    expect(result).toEqual({ ok: true, data: { token: "a".repeat(64) } });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lager nytt token og lagrer det", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ calendarToken: null });
    const result = await getOrCreateCalendarToken(actor);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.token).toHaveLength(64);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { calendarToken: expect.any(String) },
    });
  });

  it("avviser for kort token", async () => {
    expect(await getCalendarFeed("kort")).toBeNull();
  });

  it("bygger ICS med escaped tittel og datoer", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...actor,
      roleDefinition: null,
    });
    mocks.prisma.workOrder.findMany.mockResolvedValue([
      {
        id: "wo1",
        title: "Test, oppdrag",
        description: "Linje 1\nLinje 2",
        status: "PLANNED",
        scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
        scheduledTo: new Date("2026-10-20T00:00:00.000Z"),
        customer: {
          name: "Kunde AS",
          address: "Gate 1",
          postalCode: "1234",
          city: "Oslo",
        },
      },
    ]);

    const feed = await getCalendarFeed("a".repeat(64));
    expect(feed).toContain("BEGIN:VCALENDAR");
    expect(feed).toContain("BEGIN:VEVENT");
    expect(feed).toContain("SUMMARY:Test\\, oppdrag");
    expect(feed).toContain("DTSTART;VALUE=DATE:20261019");
    expect(feed).toContain("DTEND;VALUE=DATE:20261021");
    expect(feed).toContain("LOCATION:Gate 1\\, 1234\\, Oslo");
    expect(feed).toContain("END:VEVENT");
  });

  it("tilbakekaller token", async () => {
    const result = await revokeCalendarToken(actor);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { calendarToken: null },
    });
  });
});
