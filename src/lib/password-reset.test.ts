import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  hash: vi.fn(async () => "ny-hash"),
  bumpSessionVersion: vi.fn(),
  clearCalendarToken: vi.fn(),
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));
vi.mock("@/lib/session", () => ({
  bumpSessionVersion: mocks.bumpSessionVersion,
}));
vi.mock("@/server/calendar-feed", () => ({
  clearCalendarToken: mocks.clearCalendarToken,
}));
vi.mock("@/lib/invite", () => ({ hashToken: mocks.hashToken }));

import { resetPasswordWithToken } from "./password-reset";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) =>
      callback({ user: { updateMany: mocks.updateMany } }),
  );
  mocks.audit.mockResolvedValue(undefined);
  mocks.bumpSessionVersion.mockResolvedValue(1);
  mocks.clearCalendarToken.mockResolvedValue(undefined);
  mocks.hash.mockResolvedValue("ny-hash");
});

describe("resetPasswordWithToken", () => {
  it("forbruker nøkkelen, logger med actorId og invaliderer øktene", async () => {
    const result = await resetPasswordWithToken("token", "nytt-passord");

    expect(result).toBe("ok");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "u1",
        resetToken: "hash:token",
        resetTokenExpiry: { gt: expect.any(Date) },
      },
      data: {
        password: "ny-hash",
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "User",
        entityId: "u1",
        actor: { id: "u1", name: "Kari", email: "kari@example.test" },
        metadata: { method: "password_reset" },
      }),
    );
    // Nøkkelen skal aldri havne i revisjonsloggen.
    const entry = JSON.stringify(mocks.audit.mock.calls[0][1]);
    expect(entry).not.toContain("hash:token");
    expect(mocks.bumpSessionVersion).toHaveBeenCalledWith("u1");
    expect(mocks.clearCalendarToken).toHaveBeenCalledWith("u1");
  });

  it("avviser når en samtidig forespørsel allerede har brukt nøkkelen", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await resetPasswordWithToken("token", "nytt-passord");

    expect(result).toBe("invalid");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.bumpSessionVersion).not.toHaveBeenCalled();
    expect(mocks.clearCalendarToken).not.toHaveBeenCalled();
  });

  it("avviser ukjent eller utløpt nøkkel", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const result = await resetPasswordWithToken("gammel", "nytt-passord");

    expect(result).toBe("invalid");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("avviser for kort passord før noe slås opp", async () => {
    const result = await resetPasswordWithToken("token", "kort");

    expect(result).toBe("too_short");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("avviser passord over 72 byte", async () => {
    const result = await resetPasswordWithToken("token", "a".repeat(73));

    expect(result).toBe("too_long");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("avviser ledende eller avsluttende mellomrom", async () => {
    const result = await resetPasswordWithToken("token", " langt-passord ");

    expect(result).toBe("whitespace");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
