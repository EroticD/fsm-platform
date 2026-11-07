import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  visitFindMany: vi.fn(),
  absenceFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findMany: mocks.userFindMany },
    visit: { findMany: mocks.visitFindMany },
    absence: { findMany: mocks.absenceFindMany },
  },
}));

import { loadDashboardFieldStatus } from "./dashboard-field-status";
import type { AccessUser } from "@/lib/access";
import {
  addDaysUtc,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";

const office = {
  id: "office-1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
  department: { id: "dep-1", name: "Hovedavdeling", isActive: true },
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: { permissions: ["workorders.view"] },
} as unknown as AccessUser;

const now = new Date("2026-11-07T12:00:00.000Z");
const today = todayInOslo(now);
const dayStart = osloDayStart(today);
const dayEnd = osloDayStart(
  toDateOnly(addDaysUtc(parseDateOnly(today)!, 1)),
);

function visitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-1",
    workOrderId: "wo-1",
    status: "EN_ROUTE",
    startsAt: new Date("2026-11-07T10:00:00.000Z"),
    endsAt: new Date("2026-11-07T11:00:00.000Z"),
    allDay: false,
    enRouteAt: new Date("2026-11-07T09:50:00.000Z"),
    onSiteAt: null,
    doneAt: null,
    technicians: [{ userId: "tech-1" }],
    locationPings: [
      {
        userId: "tech-1",
        recordedAt: new Date("2026-11-07T11:50:00.000Z"),
      },
    ],
    workOrder: {
      id: "wo-1",
      title: "Service heis",
      customer: { name: "Testkunde" },
      department: { trackingEnabled: true },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindMany.mockResolvedValue([
    { id: "tech-1", name: "Ola Montør", role: "TECHNICIAN" },
    { id: "office-2", name: "Kari Kontor", role: "OFFICE" },
  ]);
  mocks.visitFindMany.mockResolvedValue([]);
  mocks.absenceFindMany.mockResolvedValue([]);
});

describe("dashbordets feltstatus-tjeneste", () => {
  it("bruker avdelingssperre både for ansatte og oppdrag", async () => {
    await loadDashboardFieldStatus(office, { now });

    const userWhere = mocks.userFindMany.mock.calls[0][0].where;
    expect(userWhere.AND).toContainEqual({ departmentId: "dep-1" });

    const visitWhere = mocks.visitFindMany.mock.calls[0][0].where;
    expect(visitWhere.startsAt).toEqual({ lt: dayEnd });
    expect(visitWhere.endsAt).toEqual({ gt: dayStart });
    expect(visitWhere.workOrder.AND[0]).toMatchObject({
      departmentId: "dep-1",
      department: { isActive: true },
      deletedAt: null,
    });
  });

  it("returnerer dagens status og siste posisjon for en aktiv montør", async () => {
    mocks.visitFindMany.mockResolvedValue([visitRow()]);

    const status = await loadDashboardFieldStatus(office, { now });

    expect(status.rows).toHaveLength(1);
    expect(status.rows[0]).toMatchObject({
      userId: "tech-1",
      name: "Ola Montør",
      status: "EN_ROUTE",
      lastPositionAt: new Date("2026-11-07T11:50:00.000Z"),
    });
    expect(status.rows[0].visit).toMatchObject({
      title: "Service heis",
      customerName: "Testkunde",
    });
  });

  it("skjuler posisjon når avdelingen har slått av sporing", async () => {
    const row = visitRow({
      workOrder: {
        id: "wo-1",
        title: "Service heis",
        customer: { name: "Testkunde" },
        department: { trackingEnabled: false },
      },
    });
    mocks.visitFindMany.mockResolvedValue([row]);

    const status = await loadDashboardFieldStatus(office, { now });

    expect(status.rows[0].status).toBe("EN_ROUTE");
    expect(status.rows[0].lastPositionAt).toBeNull();
  });

  it("tar bare med kontoransatte som har en visitt i dag", async () => {
    const status = await loadDashboardFieldStatus(office, { now });

    expect(status.rows.map((row) => row.userId)).toEqual(["tech-1"]);
    expect(status.rows[0].status).toBe("AVAILABLE");
  });

  it("avviser kundeportalbrukere uten å spørre databasen", async () => {
    const customer = {
      ...office,
      role: "CUSTOMER",
      customerId: "cust-1",
    } as unknown as AccessUser;

    const status = await loadDashboardFieldStatus(customer, { now });

    expect(status.rows).toEqual([]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});
