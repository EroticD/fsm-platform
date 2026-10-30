import { describe, expect, it } from "vitest";
import {
  BOOKING_REQUEST_STATUSES,
  bookingDisplayStatus,
  canCustomerCancelBooking,
  canCustomerRescheduleBooking,
  isOpenBookingStatus,
  isTerminalBookingStatus,
} from "./booking-status";

const deadline = new Date("2026-11-08T08:00:00+01:00");
const beforeDeadline = new Date("2026-11-07T08:00:00+01:00");
const afterDeadline = new Date("2026-11-09T08:00:00+01:00");

describe("bookingstatus", () => {
  it("har de fire stabile statusene", () => {
    expect(BOOKING_REQUEST_STATUSES).toEqual([
      "PENDING",
      "CONFIRMED",
      "CANCELLED",
      "EXPIRED",
    ]);
  });

  it("skiller åpne og lukkede statuser", () => {
    expect(isOpenBookingStatus("PENDING")).toBe(true);
    expect(isOpenBookingStatus("CONFIRMED")).toBe(true);
    expect(isOpenBookingStatus("CANCELLED")).toBe(false);
    expect(isOpenBookingStatus("EXPIRED")).toBe(false);
    expect(isTerminalBookingStatus("EXPIRED")).toBe(true);
  });

  it("viser bekreftet, fullført, avlyst og utløpt riktig", () => {
    expect(bookingDisplayStatus("CONFIRMED", "PLANNED")).toBe("confirmed");
    expect(bookingDisplayStatus("CONFIRMED", "COMPLETED")).toBe("completed");
    expect(bookingDisplayStatus("CONFIRMED", "CANCELLED")).toBe("cancelled");
    expect(bookingDisplayStatus("EXPIRED", "OPEN")).toBe("expired");
    expect(bookingDisplayStatus("PENDING", "OPEN")).toBe("pending");
  });

  it("lar kunden kansellere en ventende forespørsel også når arbeidet er i gang", () => {
    expect(canCustomerCancelBooking("PENDING", "IN_PROGRESS")).toBe(true);
    expect(canCustomerCancelBooking("CONFIRMED", "IN_PROGRESS")).toBe(false);
    expect(canCustomerCancelBooking("CONFIRMED", "PLANNED")).toBe(true);
    expect(canCustomerCancelBooking("EXPIRED", "PLANNED")).toBe(false);
  });

  it("respekterer endringsfristen for både PENDING og CONFIRMED", () => {
    expect(
      canCustomerRescheduleBooking("PENDING", "OPEN", deadline, beforeDeadline),
    ).toBe(true);
    expect(
      canCustomerRescheduleBooking(
        "CONFIRMED",
        "PLANNED",
        deadline,
        beforeDeadline,
      ),
    ).toBe(true);
    expect(
      canCustomerRescheduleBooking(
        "CONFIRMED",
        "PLANNED",
        deadline,
        afterDeadline,
      ),
    ).toBe(false);
    expect(
      canCustomerRescheduleBooking("EXPIRED", "OPEN", deadline, beforeDeadline),
    ).toBe(false);
  });
});
