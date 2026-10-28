import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    template: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    report: {
      findMany: vi.fn(),
    },
    workOrder: {
      findMany: vi.fn(),
    },
  },
  addTemplate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("./work-orders", () => ({ addTemplate: mocks.addTemplate }));

import { HMS_FORM_GROUPS } from "@/lib/hms";
import { getHmsOverview, hmsWorkOrderKind, linkHmsTemplateToWorkOrder } from "./hms";

function actor(
  permissions: string[],
  overrides: Partial<ServiceActor> = {},
): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions },
    ...overrides,
  };
}

const hmsTemplate = {
  id: "template-sja",
  title: "Sikker Jobb Analyse (SJA)",
  reportName: "SJA",
  description: "Risikovurdering før oppstart",
  hmsType: "SJA",
  _count: { reports: 2, workOrder: 3 },
};

const hotWorkTemplate = {
  id: "template-hot",
  title: "Tillatelse til varmt arbeid",
  reportName: null,
  description: null,
  hmsType: "HOT_WORK",
  _count: { reports: 0, workOrder: 1 },
};

const recentReport = {
  id: "report-1",
  name: "SJA",
  templateTitle: "Sikker Jobb Analyse (SJA)",
  completedAt: new Date("2026-02-01T10:00:00Z"),
  isLocked: true,
  hmsType: "SJA" as const,
  template: { title: "Sikker Jobb Analyse (SJA)" },
  workOrder: {
    id: "wo-1",
    title: "Service på anlegg",
    orderNumber: "1001",
    status: "COMPLETED",
    customerId: "customer-1",
    customer: { name: "Kunde AS" },
  },
};

const internalReport = {
  ...recentReport,
  id: "report-2",
  name: null,
  template: null,
  workOrder: {
    ...recentReport.workOrder,
    id: "wo-2",
    title: "Intern gjennomgang",
    customerId: null,
    customer: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.template.findMany.mockResolvedValue([hmsTemplate, hotWorkTemplate]);
  mocks.prisma.template.findFirst.mockResolvedValue({ id: hmsTemplate.id });
  mocks.prisma.report.findMany.mockResolvedValue([recentReport, internalReport]);
  mocks.prisma.workOrder.findMany.mockResolvedValue([
    {
      id: "wo-1",
      title: "Service på anlegg",
      orderNumber: "1001",
      status: "IN_PROGRESS",
      customerId: "customer-1",
      customer: { name: "Kunde AS" },
    },
    {
      id: "wo-2",
      title: "Intern gjennomgang",
      orderNumber: null,
      status: "OPEN",
      customerId: null,
      customer: null,
    },
  ]);
  mocks.addTemplate.mockResolvedValue({ ok: true });
});

describe("getHmsOverview – tilgang", () => {
  it("avviser inaktive brukere og kundeportalbrukere", async () => {
    const inactive = await getHmsOverview(
      actor(["templates.view"], { isActive: false }),
    );
    expect(inactive).toEqual({ ok: false, reason: "forbidden" });

    const customer = await getHmsOverview(
      actor(["templates.view", "reports.view"], { role: "CUSTOMER" }),
    );
    expect(customer).toEqual({ ok: false, reason: "forbidden" });
  });

  it("avviser ansatte uten templates.view og reports.view", async () => {
    const result = await getHmsOverview(actor(["workorders.view"]));

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.template.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.report.findMany).not.toHaveBeenCalled();
  });
});

describe("getHmsOverview – maler og tellinger", () => {
  it("henter bare HMS-maler med brukstall", async () => {
    const result = await getHmsOverview(actor(["templates.view"]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mocks.prisma.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: "HMS" },
        include: {
          _count: { select: { reports: true, workOrder: true } },
        },
      }),
    );
    expect(result.data.templates).toEqual([
      {
        id: "template-sja",
        title: "Sikker Jobb Analyse (SJA)",
        reportName: "SJA",
        description: "Risikovurdering før oppstart",
        hmsType: "SJA",
        reportCount: 2,
        workOrderCount: 3,
      },
      {
        id: "template-hot",
        title: "Tillatelse til varmt arbeid",
        reportName: null,
        description: null,
        hmsType: "HOT_WORK",
        reportCount: 0,
        workOrderCount: 1,
      },
    ]);
  });

  it("teller maler per hmsType i grupperekkefølgen", async () => {
    const result = await getHmsOverview(actor(["templates.view"]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.countsByType).toHaveLength(HMS_FORM_GROUPS.length);
    expect(result.data.countsByType).toContainEqual({ type: "SJA", count: 1 });
    expect(result.data.countsByType).toContainEqual({
      type: "HOT_WORK",
      count: 1,
    });
    expect(result.data.countsByType).toContainEqual({
      type: "DEVIATION",
      count: 0,
    });
  });

  it("kjører ikke rapport- eller oppdragsspørringer uten de rettighetene", async () => {
    const result = await getHmsOverview(actor(["templates.view"]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mocks.prisma.report.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
    expect(result.data.recentReports).toEqual([]);
    expect(result.data.workOrders).toEqual([]);
    expect(result.data.permissions.canViewReports).toBe(false);
    expect(result.data.permissions.canLinkTemplates).toBe(false);
  });
});

describe("getHmsOverview – HMS-dokumentasjon", () => {
  it("avgrenser rapporter til oppdrag i egen avdeling", async () => {
    const result = await getHmsOverview(
      actor(["templates.view", "reports.view", "workorders.view"]),
    );
    expect(result.ok).toBe(true);
    expect(mocks.prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          templateCategory: "HMS",
          deletedAt: null,
          workOrder: {
            departmentId: "dep-a",
            department: { isActive: true },
            deletedAt: null,
          },
        },
        take: 50,
      }),
    );
  });

  it("skjuler HMS-rapporter på kansellerte oppdrag for montører", async () => {
    const result = await getHmsOverview(
      actor(["templates.view", "reports.view"], { role: "TECHNICIAN" }),
    );

    expect(result.ok).toBe(true);
    expect(mocks.prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workOrder: expect.objectContaining({
            status: { not: "CANCELLED" },
          }),
        }),
      }),
    );
  });

  it("gir administrator tilgang til alle ikke-slettede oppdrag", async () => {
    await getHmsOverview(actor([], { role: "ADMIN" }));

    expect(mocks.prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          templateCategory: "HMS",
          deletedAt: null,
          workOrder: { deletedAt: null },
        },
      }),
    );
  });

  it("viser rapportnavn med fallback og merker interne oppdrag", async () => {
    const result = await getHmsOverview(
      actor(["templates.view", "reports.view"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.recentReports[0]).toMatchObject({
      id: "report-1",
      reportName: "SJA",
      isLocked: true,
      workOrder: {
        id: "wo-1",
        customerId: "customer-1",
        customerName: "Kunde AS",
      },
    });
    expect(result.data.recentReports[1]).toMatchObject({
      reportName: "Sikker Jobb Analyse (SJA)",
      workOrder: {
        id: "wo-2",
        customerId: null,
        customerName: null,
      },
    });
  });

  it("lister bare aktive oppdrag brukeren kan koble skjemaer til", async () => {
    const result = await getHmsOverview(
      actor(["templates.view", "workorders.update"]),
    );

    expect(result.ok).toBe(true);
    expect(mocks.prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: "dep-a",
          department: { isActive: true },
          deletedAt: null,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        take: 100,
      }),
    );
  });

  it("merker interne og kundeoppdrag tydelig", async () => {
    const result = await getHmsOverview(
      actor(["templates.view", "workorders.update"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.workOrders[0]).toMatchObject({
      id: "wo-1",
      customerName: "Kunde AS",
      kind: "customer",
    });
    expect(result.data.workOrders[1]).toMatchObject({
      id: "wo-2",
      customerName: null,
      kind: "internal",
    });
    expect(hmsWorkOrderKind(null)).toBe("internal");
    expect(hmsWorkOrderKind("customer-1")).toBe("customer");
  });
});

describe("linkHmsTemplateToWorkOrder", () => {
  it("krever templates.view og en oppdragsrettighet", async () => {
    const noLibrary = await linkHmsTemplateToWorkOrder(
      actor(["workorders.edit"]),
      "wo-1",
      "template-sja",
    );
    expect(noLibrary).toEqual({ ok: false, reason: "forbidden" });

    const noWorkOrderPermission = await linkHmsTemplateToWorkOrder(
      actor(["templates.view"]),
      "wo-1",
      "template-sja",
    );
    expect(noWorkOrderPermission).toEqual({ ok: false, reason: "forbidden" });

    expect(mocks.prisma.template.findFirst).not.toHaveBeenCalled();
    expect(mocks.addTemplate).not.toHaveBeenCalled();
  });

  it("avviser tomme id-er uten å slå opp mal", async () => {
    const result = await linkHmsTemplateToWorkOrder(
      actor(["templates.view", "workorders.edit"]),
      "",
      "template-sja",
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.template.findFirst).not.toHaveBeenCalled();
    expect(mocks.addTemplate).not.toHaveBeenCalled();
  });

  it("avviser maler som ikke er HMS-maler", async () => {
    mocks.prisma.template.findFirst.mockResolvedValue(null);

    const result = await linkHmsTemplateToWorkOrder(
      actor(["templates.view", "workorders.edit"]),
      "wo-1",
      "service-template",
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.template.findFirst).toHaveBeenCalledWith({
      where: { id: "service-template", category: "HMS" },
      select: { id: true },
    });
    expect(mocks.addTemplate).not.toHaveBeenCalled();
  });

  it("kobler via oppdragstjenesten med riktig rettighet og aktør", async () => {
    const user = actor(["templates.view", "workorders.edit"]);

    const result = await linkHmsTemplateToWorkOrder(
      user,
      "wo-1",
      "template-sja",
    );

    expect(result).toEqual({ ok: true, data: { workOrderId: "wo-1" } });
    expect(mocks.addTemplate).toHaveBeenCalledWith(
      user,
      "wo-1",
      "template-sja",
      "workorders.edit",
    );
  });

  it("bruker workorders.update for montører uten edit", async () => {
    const user = actor(["templates.view", "workorders.update"], {
      role: "TECHNICIAN",
    });

    await linkHmsTemplateToWorkOrder(user, "wo-1", "template-sja");

    expect(mocks.addTemplate).toHaveBeenCalledWith(
      user,
      "wo-1",
      "template-sja",
      "workorders.update",
    );
  });

  it("videresender avdelingssperren fra addTemplate", async () => {
    mocks.addTemplate.mockResolvedValue({
      ok: false,
      error: "ikke-tilgang",
    });

    const result = await linkHmsTemplateToWorkOrder(
      actor(["templates.view", "workorders.edit"]),
      "wo-other-department",
      "template-sja",
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("oversetter låst oppdrag og ugyldig data", async () => {
    mocks.addTemplate.mockResolvedValueOnce({
      ok: false,
      error: "workorder-locked",
    });
    const locked = await linkHmsTemplateToWorkOrder(
      actor(["templates.view", "workorders.edit"]),
      "wo-1",
      "template-sja",
    );
    expect(locked).toEqual({ ok: false, reason: "conflict" });

    mocks.addTemplate.mockResolvedValueOnce({
      ok: false,
      error: "ugyldig-data",
    });
    const invalid = await linkHmsTemplateToWorkOrder(
      actor(["templates.view", "workorders.edit"]),
      "wo-1",
      "template-sja",
    );
    expect(invalid).toEqual({ ok: false, reason: "invalid" });
  });
});
