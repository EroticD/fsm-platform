import { describe, expect, it } from "vitest";
import {
  calendarEditingOptions,
  toCalendarEvent,
} from "@/lib/calendar-events";

const customer = {
  address: "Storgata 1",
  postalCode: "6002",
  city: "Ålesund",
};

describe("toCalendarEvent", () => {
  it("lager en éndagshendelse uten sluttdato", () => {
    const event = toCalendarEvent({
      id: "wo-1",
      title: "Service",
      status: "PLANNED",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: null,
      customer,
    });

    expect(event).toMatchObject({
      id: "wo-1",
      title: "Service",
      start: "2026-10-19",
      allDay: true,
      extendedProps: { address: "Storgata 1, 6002 Ålesund" },
    });
    expect(event?.end).toBeUndefined();
  });

  it("gjør siste inkluderte dag om til eksklusiv sluttdato", () => {
    const event = toCalendarEvent({
      id: "wo-2",
      title: "Flerdagers",
      status: "IN_PROGRESS",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: new Date("2026-10-21T00:00:00.000Z"),
      customer,
    });

    expect(event?.start).toBe("2026-10-19");
    expect(event?.end).toBe("2026-10-22");
  });

  it("ignorerer sluttdato før startdato", () => {
    const event = toCalendarEvent({
      id: "wo-3",
      title: "Rar",
      status: "PLANNED",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: new Date("2026-10-18T00:00:00.000Z"),
      customer,
    });

    expect(event?.end).toBeUndefined();
  });

  it("gir statusfarge og håndterer manglende kunde", () => {
    const event = toCalendarEvent({
      id: "wo-4",
      title: "Fullført",
      status: "COMPLETED",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: null,
      customer: null,
    });

    expect(event?.color).toBe("#16a34a");
    expect(event?.extendedProps.address).toBe("");
    // Fullførte oppdrag kan ikke flyttes, selv om kalenderen er redigerbar.
    expect(event?.editable).toBe(false);
    expect(event?.startEditable).toBe(false);
  });

  it("gjør åpne oppdrag flyttbare når kalenderen er redigerbar", () => {
    const event = toCalendarEvent({
      id: "wo-6",
      title: "Åpen",
      status: "OPEN",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: null,
      customer,
    });

    expect(event?.editable).toBe(true);
    expect(event?.durationEditable).toBe(true);
  });

  it("returnerer null uten startdato", () => {
    expect(
      toCalendarEvent({
        id: "wo-5",
        title: "Uten dato",
        status: "OPEN",
        scheduledFor: null,
        scheduledTo: null,
        customer: null,
      }),
    ).toBeNull();
  });
});

describe("calendarEditingOptions", () => {
  it("slår av all redigering uten lagringsrettighet", () => {
    expect(calendarEditingOptions(false)).toEqual({
      editable: false,
      droppable: false,
      eventDurationEditable: false,
    });
  });

  it("slår på dra, slipp og varighet bare med lagringsrettighet", () => {
    expect(calendarEditingOptions(true)).toEqual({
      editable: true,
      droppable: true,
      eventDurationEditable: true,
    });
  });
});
