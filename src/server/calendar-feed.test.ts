import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    workOrder: { findMany: vi.fn() },
  },
  allowRequestDb: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));

import {
  clearCalendarToken,
  getCalendarFeed,
  getCalendarTokenStatus,
  getOrCreateCalendarToken,
  regenerateCalendarToken,
  revokeCalendarToken,
  sha256,
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

const RAW_TOKEN = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.user.findUnique.mockResolvedValue(null);
  mocks.prisma.user.update.mockResolvedValue({});
  mocks.prisma.workOrder.findMany.mockResolvedValue([]);
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});

describe("sha256", () => {
  it("er deterministisk og lagrer ikke klartekst", () => {
    expect(sha256(RAW_TOKEN)).toBe(sha256(RAW_TOKEN));
    expect(sha256(RAW_TOKEN)).toHaveLength(64);
    expect(sha256(RAW_TOKEN)).not.toBe(RAW_TOKEN);
  });
});

describe("getCalendarTokenStatus", () => {
  it("returnerer bare status – aldri selve tokenet", async () => {
    const createdAt = new Date("2026-10-01T10:00:00.000Z");
    const lastUsedAt = new Date("2026-10-02T10:00:00.000Z");
    mocks.prisma.user.findUnique.mockResolvedValue({
      calendarTokenHash: sha256(RAW_TOKEN),
      calendarTokenCreatedAt: createdAt,
      calendarTokenLastUsedAt: lastUsedAt,
    });

    const result = await getCalendarTokenStatus(actor);

    expect(result).toEqual({
      ok: true,
      data: { active: true, createdAt, lastUsedAt },
    });
    // Statusoppslaget skal aldri be om klartekstkolonnen.
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: {
        calendarTokenHash: true,
        calendarTokenCreatedAt: true,
        calendarTokenLastUsedAt: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(result)).not.toContain(sha256(RAW_TOKEN));
  });

  it("melder inaktiv når hashen er tom", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      calendarTokenHash: null,
      calendarTokenCreatedAt: null,
      calendarTokenLastUsedAt: null,
    });

    await expect(getCalendarTokenStatus(actor)).resolves.toEqual({
      ok: true,
      data: { active: false, createdAt: null, lastUsedAt: null },
    });
  });
});

describe("getOrCreateCalendarToken", () => {
  it("gjenbruker ikke en eksisterende lenke – tokenet returneres aldri igjen", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      calendarTokenHash: sha256("gammelt-token"),
    });

    const result = await getOrCreateCalendarToken(actor);

    expect(result).toEqual({ ok: true, data: { token: null } });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lager nytt token og lagrer bare hashen", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ calendarTokenHash: null });

    const result = await getOrCreateCalendarToken(actor);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.token) throw new Error("mangler token");
    expect(result.data.token).toHaveLength(64);

    const update = mocks.prisma.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "u1" });
    expect(update.data.calendarTokenHash).toBe(sha256(result.data.token));
    expect(update.data.calendarTokenHash).not.toBe(result.data.token);
    expect(update.data).not.toHaveProperty("calendarToken");
    expect(update.data.calendarTokenCreatedAt).toBeInstanceOf(Date);
  });
});

describe("regenerateCalendarToken", () => {
  it("lagrer en helt ny hash og returnerer det nye tokenet én gang", async () => {
    const oldToken = "b".repeat(64);
    const oldHash = sha256(oldToken);
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1" })
      // Etter rotasjon finnes ikke det gamle tokenet lenger.
      .mockResolvedValueOnce(null);

    const result = await regenerateCalendarToken(actor);
    if (!result.ok || !result.data.token) throw new Error("mangler token");

    const update = mocks.prisma.user.update.mock.calls[0][0];
    expect(update.data.calendarTokenHash).toBe(sha256(result.data.token));
    expect(update.data.calendarTokenHash).not.toBe(oldHash);

    const feed = await getCalendarFeed(oldToken);
    expect(feed).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.user.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { calendarTokenHash: oldHash },
      }),
    );
  });
});

describe("revokeCalendarToken", () => {
  it("fjerner hash og tidsstempler", async () => {
    const result = await revokeCalendarToken(actor);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        calendarTokenHash: null,
        calendarTokenCreatedAt: null,
        calendarTokenLastUsedAt: null,
      },
    });
  });

  it("clearCalendarToken kan brukes i en transaksjon", async () => {
    const tx = {
      user: { update: vi.fn(async () => ({})) },
    } as unknown as Prisma.TransactionClient;
    await clearCalendarToken("u2", tx);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: {
        calendarTokenHash: null,
        calendarTokenCreatedAt: null,
        calendarTokenLastUsedAt: null,
      },
    });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("getCalendarFeed", () => {
  it("autentiserer bare mot hashen – gammelt klarteksttoken virker ikke", async () => {
    // Databasen har hashen til det nye tokenet, men klartekstkolonnen fra
    // før migreringen ville fortsatt ha inneholdt det gamle tokenet.
    const oldPlaintext = "c".repeat(64);
    mocks.prisma.user.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where.calendarToken === oldPlaintext) {
          return { ...actor, roleDefinition: null };
        }
        return null;
      },
    );

    const result = await getCalendarFeed(oldPlaintext);

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { calendarTokenHash: sha256(oldPlaintext) },
      }),
    );
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it("avviser tilbakekalt eller ukjent token", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    await expect(getCalendarFeed(RAW_TOKEN)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("returnerer 429-resultat når rate limit er brukt opp", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...actor,
      roleDefinition: null,
    });
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 37,
    });

    const result = await getCalendarFeed(RAW_TOKEN);

    expect(result).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 37,
    });
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      `ical:${sha256(RAW_TOKEN)}`,
      120,
      60_000,
    );
    // Rate limit skal stoppe før skriving og oppdragslesing.
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it("avviser feilformat token uten database- eller rate-limit-arbeid", async () => {
    await expect(getCalendarFeed("ikke-et-token")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
  });

  it("avgrenser montører til oppdrag de er tildelt", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...actor,
      roleDefinition: null,
    });

    const result = await getCalendarFeed(RAW_TOKEN);

    expect(result.ok).toBe(true);
    const where = mocks.prisma.workOrder.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({
      AND: [
        { technicians: { some: { id: "u1" } } },
        { departmentId: "dep-a" },
      ],
    });
    expect(where.AND).toContainEqual({ status: { not: "CANCELLED" } });
    expect(where.AND).toContainEqual({ scheduledFor: { not: null } });
  });

  it("gir tom feed for montør uten oppdragsrettighet", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...actor,
      permissionsCustomized: true,
      permissions: [],
      roleDefinition: { permissions: [] },
    });

    await getCalendarFeed(RAW_TOKEN);

    const where = mocks.prisma.workOrder.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({
      AND: [
        { technicians: { some: { id: "u1" } } },
        { id: { in: [] } },
      ],
    });
  });

  it("avgrenser kunder til egen kunde", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...actor,
      role: "CUSTOMER",
      customerId: "kunde-1",
      roleDefinition: null,
    });

    await getCalendarFeed(RAW_TOKEN);

    const where = mocks.prisma.workOrder.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ customerId: "kunde-1" });
  });

  it("oppdaterer lastUsedAt etter vellykket oppslag og bygger ICS", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      ...actor,
      role: "OFFICE",
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

    const result = await getCalendarFeed(RAW_TOKEN);

    if (!result.ok) throw new Error("forventet feed");
    expect(result.feed).toContain("BEGIN:VCALENDAR");
    expect(result.feed).toContain("BEGIN:VEVENT");
    expect(result.feed).toContain("SUMMARY:Test\\, oppdrag");
    expect(result.feed).toContain("DTSTART;VALUE=DATE:20261019");
    expect(result.feed).toContain("DTEND;VALUE=DATE:20261021");
    expect(result.feed).toContain("LOCATION:Gate 1\\, 1234\\, Oslo");
    expect(result.feed).toContain("END:VEVENT");
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { calendarTokenLastUsedAt: expect.any(Date) },
    });
  });
});
