import { describe, expect, it } from "vitest";
import {
  calendarEditingOptions,
  toCalendarEvent,
  toVisitCalendarEvent,
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

describe("toVisitCalendarEvent", () => {
  const workOrder = {
    id: "wo-1",
    title: "Årlig service",
    status: "IN_PROGRESS",
    customer: {
      name: "Kunde AS",
      address: "Storgata 1",
      postalCode: "6002",
      city: "Ålesund",
    },
  };

  it("beholder klokkeslettet på en tidsstyrt visitt", () => {
    const event = toVisitCalendarEvent({
      id: "visit-1",
      workOrderId: "wo-1",
      startsAt: new Date("2026-10-19T07:00:00.000Z"),
      endsAt: new Date("2026-10-19T09:30:00.000Z"),
      allDay: false,
      status: "ON_SITE",
      technicians: [
        { user: { name: "Ola Montør" } },
        { user: { name: null, email: "kari@example.test" } },
      ],
      workOrder,
    });

    expect(event).toMatchObject({
      id: "visit-1",
      title: "Årlig service",
      start: "2026-10-19T07:00:00.000Z",
      end: "2026-10-19T09:30:00.000Z",
      allDay: false,
      color: "#2563eb",
      editable: true,
      extendedProps: {
        address: "Storgata 1, 6002 Ålesund",
        status: "IN_PROGRESS",
        visitStatus: "ON_SITE",
        workOrderId: "wo-1",
        customer: "Kunde AS",
        title: "Årlig service",
        technicians: ["Ola Montør", "kari@example.test"],
      },
    });
  });

  it("gjør heldagsvisiter om til Oslo-datoer med eksklusiv sluttdato", () => {
    const event = toVisitCalendarEvent({
      id: "visit-2",
      workOrderId: "wo-1",
      // Oslo-midnatt 19. oktober og 22. oktober (sommertid, UTC+2).
      startsAt: new Date("2026-10-18T22:00:00.000Z"),
      endsAt: new Date("2026-10-21T22:00:00.000Z"),
      allDay: true,
      status: "PLANNED",
      technicians: [],
      workOrder,
    });

    expect(event?.start).toBe("2026-10-19");
    expect(event?.end).toBe("2026-10-22");
    expect(event?.allDay).toBe(true);
    expect(event?.extendedProps.technicians).toEqual([]);
  });

  it("låser visiter som er fullført eller kansellert", () => {
    const done = toVisitCalendarEvent({
      id: "visit-3",
      workOrderId: "wo-1",
      startsAt: new Date("2026-10-19T07:00:00.000Z"),
      endsAt: new Date("2026-10-19T08:00:00.000Z"),
      allDay: false,
      status: "DONE",
      technicians: [],
      workOrder,
    });

    expect(done?.editable).toBe(false);
    expect(done?.startEditable).toBe(false);
  });

  it("låser visiter på et fullført oppdrag", () => {
    const event = toVisitCalendarEvent({
      id: "visit-4",
      workOrderId: "wo-1",
      startsAt: new Date("2026-10-19T07:00:00.000Z"),
      endsAt: new Date("2026-10-19T08:00:00.000Z"),
      allDay: false,
      status: "PLANNED",
      technicians: [],
      workOrder: { ...workOrder, status: "COMPLETED" },
    });

    expect(event?.editable).toBe(false);
  });

  it("returnerer null for et ugyldig tidsrom", () => {
    expect(
      toVisitCalendarEvent({
        id: "visit-5",
        workOrderId: "wo-1",
        startsAt: new Date("2026-10-19T09:00:00.000Z"),
        endsAt: new Date("2026-10-19T09:00:00.000Z"),
        allDay: false,
        status: "PLANNED",
        technicians: [],
        workOrder,
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
