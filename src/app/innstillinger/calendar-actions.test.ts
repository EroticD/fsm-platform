import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  getOrCreateCalendarToken: vi.fn(),
  regenerateCalendarToken: vi.fn(),
  revokeCalendarToken: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => mocks.user),
}));
vi.mock("@/server/calendar-feed", () => ({
  getOrCreateCalendarToken: mocks.getOrCreateCalendarToken,
  regenerateCalendarToken: mocks.regenerateCalendarToken,
  revokeCalendarToken: mocks.revokeCalendarToken,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { calendarFeedAction } from "./calendar-actions";

const initial = { token: null, active: false };

function formData(intent: string): FormData {
  const form = new FormData();
  form.set("intent", intent);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1" };
  mocks.getOrCreateCalendarToken.mockResolvedValue({
    ok: true,
    data: { token: "nytt-token" },
  });
  mocks.regenerateCalendarToken.mockResolvedValue({
    ok: true,
    data: { token: "rotert-token" },
  });
  mocks.revokeCalendarToken.mockResolvedValue({ ok: true, data: undefined });
});

describe("kalenderlenke-handlinger", () => {
  it("returnerer det rå tokenet til klienten som nettopp opprettet lenken", async () => {
    await expect(calendarFeedAction(initial, formData("create"))).resolves.toEqual({
      token: "nytt-token",
      active: true,
    });
  });

  it("returnerer ikke en eksisterende lenke på nytt", async () => {
    mocks.getOrCreateCalendarToken.mockResolvedValue({
      ok: true,
      data: { token: null },
    });

    await expect(calendarFeedAction(initial, formData("create"))).resolves.toEqual({
      token: null,
      active: true,
    });
  });

  it("roterer lenken og returnerer det nye tokenet én gang", async () => {
    await expect(
      calendarFeedAction({ token: null, active: true }, formData("regenerate")),
    ).resolves.toEqual({ token: "rotert-token", active: true });
  });

  it("tilbakekaller uten å returnere noe token", async () => {
    await expect(
      calendarFeedAction({ token: null, active: true }, formData("revoke")),
    ).resolves.toEqual({ token: null, active: false });
    expect(mocks.revokeCalendarToken).toHaveBeenCalledWith(mocks.user);
  });

  it("avviser uinnloggede uten å kalle tjenestene", async () => {
    mocks.user = null;

    await expect(calendarFeedAction(initial, formData("create"))).resolves.toEqual({
      token: null,
      active: false,
      error: "forbidden",
    });
    expect(mocks.getOrCreateCalendarToken).not.toHaveBeenCalled();
  });
});
