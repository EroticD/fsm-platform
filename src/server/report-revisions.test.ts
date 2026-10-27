import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "@/lib/access";

const mocks = vi.hoisted(() => ({
  prisma: {
    report: { findFirst: vi.fn() },
    reportRevision: { findMany: vi.fn(), findFirst: vi.fn() },
    workOrder: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  getReportRevision,
  getReportRevisionForPdf,
  getWorkOrderRevisionOverview,
  listReportRevisions,
} from "./report-revisions";

function actor(overrides: Partial<AccessUser> = {}): AccessUser {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.com",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: { permissions: ["reports.view"] },
    ...overrides,
  } as unknown as AccessUser;
}

const customer = () => actor({ role: "CUSTOMER", customerId: "cust-1" });

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rep1",
    workOrderId: "wo1",
    name: "Egen rapport",
    templateTitle: "Maltittel",
    requiresUnits: true,
    revision: 3,
    completedAt: new Date("2026-01-02T10:00:00Z"),
    isLocked: true,
    legalHold: false,
    deletedAt: null,
    workOrder: {
      id: "wo1",
      title: "Serviceoppdrag",
      orderNumber: "ORD-42",
      status: "COMPLETED",
      scheduledFor: new Date("2026-01-02T00:00:00Z"),
      customerId: "cust-1",
      deletedAt: null,
      customer: { name: "Kunde AS" },
    },
    ...overrides,
  };
}

function revisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev1",
    reportId: "rep1",
    revision: 2,
    dataJson: JSON.stringify({ status: "AVVIK" }),
    unitsJson: JSON.stringify([
      {
        id: "u1",
        label: "Pumpe",
        serialNumber: "SN-1",
        location: "Kjeller",
        status: "AVVIK",
        answersJson: "{}",
        comment: null,
        sortOrder: 0,
      },
    ]),
    comments: null,
    templateTitle: "Maltittel",
    name: "Egen rapport",
    requiresUnits: true,
    completedAt: new Date("2026-01-02T10:00:00Z"),
    templateSnapshotJson: "[]",
    technicianSignatureUrl: "/uploads/tekniker.png",
    technicianName: "Kari",
    customerSignatureUrl: null,
    customerName: null,
    customerAcknowledgedAt: null,
    customerAcknowledgedBy: null,
    customerAcknowledgedComment: null,
    reason: "Rettet feil",
    createdById: "u2",
    createdAt: new Date("2026-01-03T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.reportRevision.findMany.mockResolvedValue([]);
  mocks.prisma.user.findMany.mockResolvedValue([
    { id: "u2", name: "Ola", email: "ola@example.com" },
  ]);
});

describe("listReportRevisions – tilgang", () => {
  it("lar en kunde lese revisjonene til sin egen rapport", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(reportRow());
    mocks.prisma.reportRevision.findMany.mockResolvedValue([revisionRow()]);

    const result = await listReportRevisions(customer(), "rep1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: "rev1",
      revision: 2,
      reason: "Rettet feil",
      actorName: "Ola",
      unitCount: 1,
      deviationCount: 1,
    });
  });

  it("nekter en kunde å lese en annen kundes rapport", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(
      reportRow({
        workOrder: {
          ...reportRow().workOrder,
          customerId: "cust-2",
        },
      }),
    );

    const result = await listReportRevisions(customer(), "rep1");

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.prisma.reportRevision.findMany).not.toHaveBeenCalled();
  });

  it("nekter ansatte uten reports.view", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(reportRow());

    const result = await listReportRevisions(
      actor({ roleDefinition: { permissions: [] } as never }),
      "rep1",
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("nekter montører å lese revisjoner på kansellerte oppdrag", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(
      reportRow({
        workOrder: { ...reportRow().workOrder, status: "CANCELLED" },
      }),
    );

    const result = await listReportRevisions(
      actor({ role: "TECHNICIAN" }),
      "rep1",
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("getReportRevision – øyeblikksbilde", () => {
  it("returnerer identitet, enheter og signaturer fra revisjonen", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(reportRow());
    mocks.prisma.reportRevision.findFirst.mockResolvedValue(revisionRow());

    const result = await getReportRevision(customer(), "rep1", "rev1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workOrder.orderNumber).toBe("ORD-42");
    expect(result.data.report.id).toBe("rep1");
    expect(result.data.units[0]).toMatchObject({
      label: "Pumpe",
      status: "AVVIK",
    });
    expect(result.data.technicianSignatureUrl).toBe("/uploads/tekniker.png");
  });

  it("returnerer not_found når revisjonen ikke hører til rapporten", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(reportRow());
    mocks.prisma.reportRevision.findFirst.mockResolvedValue(null);

    const result = await getReportRevision(customer(), "rep1", "rev-annen");

    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("getReportRevisionForPdf", () => {
  it("slår opp direkte på revisjons-id og respekterer kundetilknytningen", async () => {
    mocks.prisma.reportRevision.findFirst.mockResolvedValue(revisionRow());
    mocks.prisma.report.findFirst.mockResolvedValue(reportRow());

    const result = await getReportRevisionForPdf(customer(), "rev1");

    expect(result.ok).toBe(true);
    expect(mocks.prisma.report.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "rep1" }),
      }),
    );
  });

  it("avviser en annen kunde", async () => {
    mocks.prisma.reportRevision.findFirst.mockResolvedValue(revisionRow());
    mocks.prisma.report.findFirst.mockResolvedValue(
      reportRow({
        workOrder: { ...reportRow().workOrder, customerId: "cust-2" },
      }),
    );

    const result = await getReportRevisionForPdf(customer(), "rev1");

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("getWorkOrderRevisionOverview", () => {
  it("grupperer alle rapporter på oppdraget med revisjonene sine", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      title: "Serviceoppdrag",
      orderNumber: "ORD-42",
      status: "COMPLETED",
      scheduledFor: new Date("2026-01-02T00:00:00Z"),
      customerId: "cust-1",
      customer: { name: "Kunde AS" },
      reports: [
        {
          ...reportRow(),
          id: "rep1",
          revisions: undefined,
        },
        {
          ...reportRow(),
          id: "rep2",
          name: "Andre rapport",
          revision: 0,
        },
      ],
    });
    mocks.prisma.reportRevision.findMany.mockResolvedValue([
      revisionRow(),
      revisionRow({ id: "rev2", reportId: "rep2", revision: 0 }),
    ]);

    const result = await getWorkOrderRevisionOverview(customer(), "wo1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workOrder.orderNumber).toBe("ORD-42");
    expect(result.data.reports).toHaveLength(2);
    expect(result.data.reports[0].revisions[0].id).toBe("rev1");
  });

  it("nekter tilgang før noen rapporter leses", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      title: "Serviceoppdrag",
      orderNumber: null,
      status: "COMPLETED",
      scheduledFor: null,
      customerId: "cust-2",
      customer: { name: "Annen kunde" },
      reports: [],
    });

    const result = await getWorkOrderRevisionOverview(customer(), "wo1");

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.prisma.reportRevision.findMany).not.toHaveBeenCalled();
  });
});
