import { describe, expect, it } from "vitest";
import {
  canAccessReportWorkOrder,
  canViewAllDepartmentReports,
  reportWorkOrderScope,
} from "./report-scope";

type Actor = Parameters<typeof canViewAllDepartmentReports>[0];

function actor(overrides: Partial<NonNullable<Actor>> = {}): NonNullable<Actor> {
  return {
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: ["reports.view"] },
    ...overrides,
  };
}

const withPermission = () =>
  actor({
    roleDefinition: {
      permissions: ["reports.view", "reports.viewAllDepartments"],
    },
  });

describe("canViewAllDepartmentReports", () => {
  it("gir administrator og eksplisitt rettighet tilgang til alle avdelinger", () => {
    expect(canViewAllDepartmentReports(actor({ role: "ADMIN" }))).toBe(true);
    expect(canViewAllDepartmentReports(withPermission())).toBe(true);
  });

  it("gir ikke kontor, montør eller inaktive brukere tilgang automatisk", () => {
    expect(canViewAllDepartmentReports(actor())).toBe(false);
    expect(canViewAllDepartmentReports(actor({ role: "TECHNICIAN" }))).toBe(
      false,
    );
    expect(
      canViewAllDepartmentReports(actor({ role: "ADMIN", isActive: false })),
    ).toBe(false);
  });
});

describe("reportWorkOrderScope", () => {
  it("gir aktiv-avdelingsfilter til administrator og roller med rettigheten", () => {
    const activeOnly = { department: { isActive: true } };
    expect(reportWorkOrderScope(actor({ role: "ADMIN" }))).toEqual(activeOnly);
    expect(reportWorkOrderScope(withPermission())).toEqual(activeOnly);
  });

  it("avgrenser andre ansatte til egen, aktive avdeling", () => {
    expect(reportWorkOrderScope(actor())).toEqual({
      departmentId: "dep-a",
      department: { isActive: true },
      deletedAt: null,
    });
  });

  it("gir tomt omfang uten avdeling, for inaktive kontoer og kunder", () => {
    const empty = { id: { in: [] } };
    expect(reportWorkOrderScope(actor({ departmentId: null }))).toEqual(empty);
    expect(reportWorkOrderScope(actor({ isActive: false }))).toEqual(empty);
    expect(reportWorkOrderScope(actor({ role: "CUSTOMER" }))).toEqual(empty);
    expect(
      reportWorkOrderScope(
        actor({ department: { isActive: false } }),
      ),
    ).toEqual(empty);
  });
});

describe("canAccessReportWorkOrder", () => {
  it("lar ansatte lese egen avdeling", () => {
    expect(
      canAccessReportWorkOrder(actor(), {
        departmentId: "dep-a",
        departmentIsActive: true,
      }),
    ).toBe(true);
  });

  it("nekter andre avdelinger uten rettigheten", () => {
    expect(
      canAccessReportWorkOrder(actor(), {
        departmentId: "dep-b",
        departmentIsActive: true,
      }),
    ).toBe(false);
  });

  it("lar administrator og roller med rettigheten lese andre avdelinger", () => {
    const workOrder = { departmentId: "dep-b", departmentIsActive: true };
    expect(canAccessReportWorkOrder(actor({ role: "ADMIN" }), workOrder)).toBe(
      true,
    );
    expect(canAccessReportWorkOrder(withPermission(), workOrder)).toBe(true);
  });

  it("nekter rapporter i en deaktivert avdeling", () => {
    const workOrder = { departmentId: "dep-a", departmentIsActive: false };
    expect(canAccessReportWorkOrder(actor(), workOrder)).toBe(false);
    expect(canAccessReportWorkOrder(withPermission(), workOrder)).toBe(false);
    expect(
      canAccessReportWorkOrder(actor({ role: "ADMIN" }), workOrder),
    ).toBe(false);
  });

  it("nekter kunder og inaktive aktører", () => {
    const workOrder = { departmentId: "dep-a", departmentIsActive: true };
    expect(
      canAccessReportWorkOrder(actor({ role: "CUSTOMER" }), workOrder),
    ).toBe(false);
    expect(
      canAccessReportWorkOrder(actor({ isActive: false }), workOrder),
    ).toBe(false);
  });
});
