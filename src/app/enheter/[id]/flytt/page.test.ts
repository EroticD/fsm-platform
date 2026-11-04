import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn<(user: unknown, permission: string) => boolean>(
    () => true,
  ),
  getEquipment: vi.fn(),
  getEquipmentMovePreview: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/server/equipment", () => ({ getEquipment: mocks.getEquipment }));
vi.mock("@/server/equipment-move", () => ({
  getEquipmentMovePreview: mocks.getEquipmentMovePreview,
}));
vi.mock("./EquipmentMoveForm", async () => {
  const React = await import("react");
  return {
    default: (props: {
      equipmentId: string;
      equipmentModel: string;
      currentCustomerName: string;
    }) =>
      React.createElement("div", {
        "data-testid": "move-form",
        "data-equipment-id": props.equipmentId,
        "data-equipment-model": props.equipmentModel,
        "data-customer-name": props.currentCustomerName,
      }),
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import MoveEquipmentPage from "./page";

const office = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
  customerId: null,
  permissions: ["equipment.manage", "customers.manage"],
  permissionsCustomized: true,
  roleDefinition: null,
};

const counts = {
  products: 3,
  workOrders: 2,
  visits: 2,
  reports: 2,
  reportRevisions: 1,
  reportUnits: 2,
  meterReadings: 3,
  plans: 2,
  planOccurrences: 1,
  documents: 2,
  documentVersions: 2,
  uploads: 3,
  qrCodes: 1,
  comments: 1,
};

function params(id = "p1") {
  return { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(office);
  mocks.hasPermission.mockReturnValue(true);
  mocks.getEquipment.mockResolvedValue({
    ok: true,
    data: {
      equipment: {
        id: "p1",
        model: "Rotpumpe",
        serialNumber: "SN-1",
        customer: { id: "a", name: "Gammel kunde" },
      },
    },
  });
  mocks.getEquipmentMovePreview.mockResolvedValue({
    ok: true,
    data: { counts, canMove: false, noop: false, blockers: [], warnings: [] },
  });
});

describe("/enheter/[id]/flytt", () => {
  it("renderer flytteflyten med kunde, enhet og antall for autoriserte", async () => {
    const html = renderToStaticMarkup(await MoveEquipmentPage(params()));

    expect(html).toContain('data-testid="move-form"');
    expect(html).toContain('data-equipment-id="p1"');
    expect(html).toContain('data-equipment-model="Rotpumpe"');
    expect(html).toContain('data-customer-name="Gammel kunde"');
    expect(html).toContain('href="/enheter/p1"');
    expect(mocks.getEquipmentMovePreview).toHaveBeenCalledWith(office, "p1");
  });

  it("gir 403 uten customers.manage og renderer ikke skjemaet", async () => {
    mocks.hasPermission.mockImplementation(
      (user: unknown, permission: string) => permission !== "customers.manage",
    );

    await expect(MoveEquipmentPage(params())).rejects.toThrow(
      "REDIRECT:/enheter/p1",
    );
    expect(mocks.getEquipment).not.toHaveBeenCalled();
    expect(mocks.getEquipmentMovePreview).not.toHaveBeenCalled();
  });

  it("lar administrator bruke flytteflyten uten enkeltrettigheter", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...office, role: "ADMIN" });
    mocks.hasPermission.mockReturnValue(false);

    const html = renderToStaticMarkup(await MoveEquipmentPage(params()));

    expect(html).toContain('data-testid="move-form"');
  });
});
