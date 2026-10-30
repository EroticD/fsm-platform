import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  rescheduleBooking: vi.fn(),
  getCustomerAvailability: vi.fn(),
  holdBookingSlot: vi.fn(),
  releaseBookingHold: vi.fn(),
  revalidatePath: vi.fn(),
  headers: vi.fn(),
  clientIpFrom: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/client-ip", () => ({ clientIpFrom: mocks.clientIpFrom }));
vi.mock("@/server/portal", () => ({
  createBooking: mocks.createBooking,
  cancelBooking: mocks.cancelBooking,
  rescheduleBooking: mocks.rescheduleBooking,
}));
vi.mock("@/server/availability", () => ({
  getCustomerAvailability: mocks.getCustomerAvailability,
  holdBookingSlot: mocks.holdBookingSlot,
  releaseBookingHold: mocks.releaseBookingHold,
}));

import {
  bookWorkOrderAction,
  holdSlotAction,
  loadAvailabilityAction,
  releaseHoldAction,
  type BookingActionState,
} from "./booking-actions";

const idle: BookingActionState = { status: "idle" };
const user = {
  id: "u1",
  role: "CUSTOMER",
  isActive: true,
  customerId: "cust-1",
};

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    title: "Service",
    description: "Beskrivelse",
    requestedDate: "2026-11-09",
    requestedFrom: "08:00",
    requestedTo: "08:30",
    contactName: "Kari",
    contactPhone: "12345678",
    siteId: "site-1",
    serviceType: "maintenance",
    technicianId: "tech-1",
    holdToken: "hold-token",
    ...overrides,
  })) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.headers.mockResolvedValue(new Headers());
  mocks.clientIpFrom.mockReturnValue("10.0.0.1");
  mocks.createBooking.mockResolvedValue({
    ok: true,
    data: {
      id: "wo-1",
      reference: "B-1",
      status: "CONFIRMED",
      technicianName: "Tekniker",
    },
  });
  mocks.getCustomerAvailability.mockResolvedValue({
    ok: true,
    data: { date: "2026-11-09", slots: [] },
  });
  mocks.holdBookingSlot.mockResolvedValue({
    ok: true,
    data: { token: "hold-token" },
  });
  mocks.releaseBookingHold.mockResolvedValue({ ok: true, data: undefined });
});

describe("bookingactions", () => {
  it("sender sted, tjeneste og reservasjon videre til tjenestelaget", async () => {
    const result = await bookWorkOrderAction(idle, form());

    expect(result).toEqual({
      status: "success",
      duplicate: false,
      id: "wo-1",
      reference: "B-1",
      bookingStatus: "CONFIRMED",
      technicianName: "Tekniker",
    });
    expect(mocks.createBooking).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        siteId: "site-1",
        serviceType: "maintenance",
        technicianId: "tech-1",
        holdToken: "hold-token",
        requestedDate: "2026-11-09",
        requestedFrom: "08:00",
        requestedTo: "08:30",
        ip: "10.0.0.1",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kundeportal");
  });

  it("avviser uten innlogget bruker", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(bookWorkOrderAction(idle, form())).resolves.toEqual({
      status: "error",
      reason: "forbidden",
    });
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("henter ledige timer og reserverer en time", async () => {
    await loadAvailabilityAction("2026-11-09");
    expect(mocks.getCustomerAvailability).toHaveBeenCalledWith(user, {
      date: "2026-11-09",
    });

    const hold = await holdSlotAction({
      date: "2026-11-09",
      from: "08:00",
      to: "08:30",
      technicianId: "tech-1",
      siteId: "site-1",
    });
    expect(hold).toEqual({ ok: true, data: { token: "hold-token" } });
    expect(mocks.holdBookingSlot).toHaveBeenCalledWith(user, {
      date: "2026-11-09",
      from: "08:00",
      to: "08:30",
      technicianId: "tech-1",
      siteId: "site-1",
    });
  });

  it("frigjør en reservasjon", async () => {
    await expect(releaseHoldAction("hold-token")).resolves.toEqual({
      ok: true,
    });
    expect(mocks.releaseBookingHold).toHaveBeenCalledWith(user, "hold-token");
  });
});
