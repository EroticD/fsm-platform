import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  hash: vi.fn(async () => "ny-hash"),
  bumpSessionVersion: vi.fn(),
  clearCalendarToken: vi.fn(),
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock("@/lib/prisma", () => ({
  default: { user: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } },
}));
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
  mocks.findFirst.mockResolvedValue({ id: "u1" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.bumpSessionVersion.mockResolvedValue(1);
  mocks.clearCalendarToken.mockResolvedValue(undefined);
});

describe("resetPasswordWithToken", () => {
  it("forbruker nøkkelen atomisk og invaliderer øktene", async () => {
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
    expect(mocks.bumpSessionVersion).toHaveBeenCalledWith("u1");
    expect(mocks.clearCalendarToken).toHaveBeenCalledWith("u1");
  });

  it("avviser når en samtidig forespørsel allerede har brukt nøkkelen", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await resetPasswordWithToken("token", "nytt-passord");

    expect(result).toBe("invalid");
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
});
