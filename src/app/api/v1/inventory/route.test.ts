import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listInventory: vi.fn(),
  getInventoryItem: vi.fn(),
  listStockLevels: vi.fn(),
  reserveStock: vi.fn(),
  releaseReservation: vi.fn(),
  consumeReservation: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/inventory", () => ({
  listInventory: mocks.listInventory,
  getInventoryItem: mocks.getInventoryItem,
  listStockLevels: mocks.listStockLevels,
  reserveStock: mocks.reserveStock,
  releaseReservation: mocks.releaseReservation,
  consumeReservation: mocks.consumeReservation,
}));

import { GET as getItems } from "./items/route";
import { GET as getItem } from "./items/[id]/route";
import { GET as getLocations } from "./locations/route";
import { GET as getStock } from "./stock/route";
import { POST as reserve } from "./reservations/route";
import { POST as release } from "./reservations/[id]/release/route";
import { POST as consume } from "./reservations/[id]/consume/route";

function actor(): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: ["equipment.view", "equipment.manage", "workorders.update"],
    permissionsCustomized: true,
    roleDefinition: {
      permissions: ["equipment.view", "equipment.manage", "workorders.update"],
    },
  } as ServiceActor;
}

function authenticated() {
  return { ok: true, actor: actor(), apiKeyId: "key-1" };
}

function post(body: unknown) {
  return new Request("http://localhost/api/v1/inventory/reservations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const item = {
  id: "i1",
  sku: "P-50",
  name: "Pakning 50 mm",
  unit: "stk",
  minLevel: 5,
  active: true,
  onHand: 10,
  reserved: 2,
  available: 8,
  low: false,
  suggestedQuantity: 0,
};
const location = {
  id: "l1",
  name: "Hovedlager",
  type: "WAREHOUSE",
  departmentId: "dep-a",
  assignedUserId: null,
  isActive: true,
  itemCount: 1,
  lowCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.listInventory.mockResolvedValue({
    ok: true,
    data: { items: [item], locations: [location], suggestions: [] },
  });
  mocks.getInventoryItem.mockResolvedValue({
    ok: true,
    data: { item, levels: [], movements: [], reservations: [] },
  });
  mocks.listStockLevels.mockResolvedValue({ ok: true, data: [] });
  mocks.reserveStock.mockResolvedValue({
    ok: true,
    data: { id: "r1", quantity: 2, available: 8 },
  });
  mocks.releaseReservation.mockResolvedValue({ ok: true, data: { id: "r1" } });
  mocks.consumeReservation.mockResolvedValue({
    ok: true,
    data: { id: "r1", quantity: 2 },
  });
});

describe("inventory auth og modul", () => {
  it("returnerer 404 når api- eller lagermodulen er av", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response("{}", { status: 404 }),
    });
    const response = await getItems(
      new Request("http://localhost/api/v1/inventory/items"),
    );
    expect(response.status).toBe(404);
    expect(mocks.listInventory).not.toHaveBeenCalled();
  });

  it("gir 403 når tjenesten nekter tilgang", async () => {
    mocks.listInventory.mockResolvedValue({ ok: false, reason: "forbidden" });
    const response = await getItems(
      new Request("http://localhost/api/v1/inventory/items"),
    );
    expect(response.status).toBe(403);
  });
});

describe("inventory lesing", () => {
  it("lister varer og lokasjoner", async () => {
    const items = await getItems(
      new Request("http://localhost/api/v1/inventory/items?q=pakning"),
    );
    expect(items.status).toBe(200);
    expect((await items.json()).data[0].available).toBe(8);
    expect(mocks.listInventory).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      { q: "pakning" },
    );

    const locations = await getLocations(
      new Request("http://localhost/api/v1/inventory/locations"),
    );
    expect((await locations.json()).data[0].id).toBe("l1");
  });

  it("henter vare og beholdning med filtre", async () => {
    const detail = await getItem(
      new Request("http://localhost/api/v1/inventory/items/i1"),
      { params: Promise.resolve({ id: "i1" }) },
    );
    expect(detail.status).toBe(200);

    const stock = await getStock(
      new Request(
        "http://localhost/api/v1/inventory/stock?itemId=i1&locationId=l1",
      ),
    );
    expect(stock.status).toBe(200);
    expect(mocks.listStockLevels).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      { itemId: "i1", locationId: "l1" },
    );
  });
});

describe("inventory reservasjoner", () => {
  it("reserverer og returnerer tilgjengelig mengde", async () => {
    const response = await reserve(
      post({
        itemId: "i1",
        locationId: "l1",
        quantity: 2,
        workOrderId: "wo1",
      }),
    );
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      id: "r1",
      status: "ACTIVE",
      quantity: 2,
      available: 8,
    });
  });

  it("avviser manglende mål og ugyldig mengde", async () => {
    const missing = await reserve(post({ itemId: "i1", locationId: "l1" }));
    expect(missing.status).toBe(422);

    const zero = await reserve(
      post({ itemId: "i1", locationId: "l1", quantity: 0, workOrderId: "wo1" }),
    );
    expect(zero.status).toBe(422);
    expect(mocks.reserveStock).not.toHaveBeenCalled();
  });

  it("oversetter utilstrekkelig beholdning til 409", async () => {
    mocks.reserveStock.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "inventory.insufficientStock", available: 1 },
    });
    const response = await reserve(
      post({
        itemId: "i1",
        locationId: "l1",
        quantity: 5,
        workOrderId: "wo1",
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { code: "inventory.insufficientStock" } },
    });
  });

  it("frigjør og forbruker reservasjon", async () => {
    const released = await release(
      new Request("http://localhost/api/v1/inventory/reservations/r1/release", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "r1" }) },
    );
    expect(released.status).toBe(200);
    expect((await released.json()).data.status).toBe("RELEASED");

    const consumed = await consume(
      new Request("http://localhost/api/v1/inventory/reservations/r1/consume", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "r1" }) },
    );
    expect(consumed.status).toBe(200);
    expect((await consumed.json()).data).toMatchObject({
      status: "CONSUMED",
      quantity: 2,
    });
  });

  it("gir 409 når reservasjonen allerede er forbrukt", async () => {
    mocks.consumeReservation.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "inventory.reservationNotActive" },
    });
    const response = await consume(
      new Request("http://localhost/api/v1/inventory/reservations/r1/consume", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "r1" }) },
    );
    expect(response.status).toBe(409);
  });
});
