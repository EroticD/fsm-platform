import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mapMock = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => {
    void props;
    return null;
  }),
);

vi.mock("@/components/WorkOrderMap", () => ({
  default: mapMock,
}));

import DashboardFieldPanel from "./DashboardFieldPanel";
import type { FieldStatusRow } from "@/lib/dashboard-field-status";

const settings = {
  provider: "osm" as const,
  apiKey: null,
  defaultLayer: "osm" as const,
  defaultZoom: 6,
  centerLat: null,
  centerLng: null,
  scrollWheelZoom: true,
};

const t = (key: string) => key;

const rows: FieldStatusRow[] = [
  {
    userId: "tech-1",
    name: "Ola Montør",
    status: "EN_ROUTE",
    visit: {
      id: "visit-1",
      workOrderId: "wo-1",
      title: "Service heis",
      customerName: "Testkunde",
      status: "EN_ROUTE",
      startsAt: new Date("2026-11-07T10:00:00.000Z"),
      endsAt: new Date("2026-11-07T11:00:00.000Z"),
      allDay: false,
    },
    lastPositionAt: new Date("2026-11-07T11:50:00.000Z"),
  },
];

function render(props: Partial<Parameters<typeof DashboardFieldPanel>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(DashboardFieldPanel, {
      rows,
      markers: [],
      trackingEnabled: true,
      settings,
      updatedAt: new Date("2026-11-07T12:00:00.000Z"),
      locale: "nb",
      t,
      ...props,
    }),
  );
}

beforeEach(() => {
  mapMock.mockClear();
});

describe("dashbordets feltpanel", () => {
  it("viser tomtilstand når ingen deler posisjon", () => {
    const html = render();

    expect(html).toContain("dashboard.field.mapEmpty");
    expect(html).toContain("dashboard.field.status.enRoute");
    expect(html).toContain("Service heis");
    expect(html).toContain("Testkunde");
    expect(html).toContain("dashboard.field.lastShared");
    expect(mapMock).not.toHaveBeenCalled();
  });

  it("viser at sporing er slått av", () => {
    const html = render({ trackingEnabled: false });

    expect(html).toContain("dashboard.field.trackingDisabled");
    expect(html).toContain("dashboard.field.trackingDisabledHint");
    expect(html).not.toContain("dashboard.field.mapEmpty");
    expect(mapMock).not.toHaveBeenCalled();
  });

  it("viser kart og en tilgjengelig lenkeliste når posisjoner deles", () => {
    const html = render({
      markers: [
        {
          visitId: "visit-1",
          userId: "tech-1",
          name: "Ola Montør",
          status: "EN_ROUTE",
          updatedAt: new Date("2026-11-07T11:50:00.000Z"),
          lat: 59.91,
          lng: 10.75,
          workOrderId: "wo-1",
          workOrderTitle: "Service heis",
          customerName: "Testkunde",
        },
      ],
    });

    expect(mapMock).toHaveBeenCalledTimes(1);
    const props = mapMock.mock.calls[0][0] as {
      points: unknown[];
      technicians: Array<Record<string, unknown>>;
      listId: string;
    };
    expect(props.points).toEqual([]);
    expect(props.listId).toBe("dashboard-field-map-list");
    expect(props.technicians[0]).toMatchObject({
      name: "Ola Montør",
      href: "/oppdrag/wo-1",
      status: "dashboard.field.status.enRoute",
    });

    expect(html).toContain("dashboard.field.mapListTitle");
    expect(html).toContain("Ola Montør");
    expect(html).toContain("/oppdrag/wo-1");
    expect(html).toContain("/kart?technician=tech-1");
    expect(html).not.toContain("dashboard.field.mapEmpty");
  });

  it("viser «ingen posisjon delt» når en montør mangler ping", () => {
    const html = render({
      rows: [{ ...rows[0], lastPositionAt: null }],
    });

    expect(html).toContain("dashboard.field.noPosition");
  });
});
