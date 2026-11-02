import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  getCurrentUser: vi.fn(),
  confirmBooking: vi.fn(),
  cancelBookingFromOffice: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/bookings", () => ({
  confirmBooking: mocks.confirmBooking,
  cancelBookingFromOffice: mocks.cancelBookingFromOffice,
}));

import { confirmBookingAction } from "./actions";

const user = {
  id: "office-1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
});

describe("confirmBookingAction", () => {
  it("sender dato, tid og montør til tjenesten og beholder filteret", async () => {
    mocks.confirmBooking.mockResolvedValue({
      ok: true,
      data: { reference: "B-1", technicianName: "Tina", already: false },
    });

    await expect(
      confirmBookingAction(
        form({
          bookingId: "br-1",
          workOrderId: "wo-1",
          technicianId: "tech-1",
          date: "2026-11-10",
          from: "09:00",
          to: "10:00",
          filter: "pending",
          side: "2",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/bookinger?status=pending&side=2&ok=confirmed#booking-br-1",
    );

    expect(mocks.confirmBooking).toHaveBeenCalledWith(user, {
      bookingId: "br-1",
      technicianId: "tech-1",
      date: "2026-11-10",
      from: "09:00",
      to: "10:00",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/bookinger");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/oppdrag/wo-1");
  });

  it("viser en tydelig feil når forespørselen må planlegges", async () => {
    mocks.confirmBooking.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "needs_planning" },
    });

    await expect(
      confirmBookingAction(form({ bookingId: "br-1" })),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/bookinger?bookingError=needs_planning#booking-br-1",
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sender uinnloggede brukere til innlogging", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(
      confirmBookingAction(form({ bookingId: "br-1" })),
    ).rejects.toThrow("NEXT_REDIRECT:/api/auth/signin");

    expect(mocks.confirmBooking).not.toHaveBeenCalled();
  });
});
