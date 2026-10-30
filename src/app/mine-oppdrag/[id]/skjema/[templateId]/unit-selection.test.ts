import { describe, expect, it } from "vitest";
import {
  countDuplicateUnitProductIds,
  dedupeUnitProductIds,
  linkUnitToProduct,
  productIdsUsedByOtherUnits,
  selectableCustomerUnits,
  type RegisteredProduct,
  type UnitWithProduct,
} from "./unit-selection";

const products: RegisteredProduct[] = [
  { id: "prod-1", model: "Port Nord", serialNumber: "SN-1", location: "Bygg A" },
  { id: "prod-2", model: "Port Sør", serialNumber: "SN-2", location: "Bygg B" },
  { id: "prod-3", model: "Pumpe", serialNumber: null, location: null },
];

function unit(
  key: string,
  overrides: Partial<UnitWithProduct> = {},
): UnitWithProduct {
  return {
    key,
    productId: "",
    label: "",
    serialNumber: "",
    location: "",
    ...overrides,
  };
}

describe("selectableCustomerUnits", () => {
  it("skjuler enheter som er valgt i en annen rad, men beholder radens eget valg", () => {
    const units = [unit("unit-0", { productId: "prod-1" }), unit("unit-1")];

    expect(
      selectableCustomerUnits(products, units, "unit-0").map((p) => p.id),
    ).toEqual(["prod-1", "prod-2", "prod-3"]);
    expect(
      selectableCustomerUnits(products, units, "unit-1").map((p) => p.id),
    ).toEqual(["prod-2", "prod-3"]);
    expect(productIdsUsedByOtherUnits(units, "unit-1")).toEqual(
      new Set(["prod-1"]),
    );
  });
});

describe("linkUnitToProduct", () => {
  it("avviser samme registrerte enhet i en annen rad og lar første rad stå urørt", () => {
    const units = [unit("unit-0"), unit("unit-1")];

    const first = linkUnitToProduct(units, "unit-0", products[0]);
    expect(first.duplicate).toBe(false);
    expect(first.units[0]).toMatchObject({
      productId: "prod-1",
      label: "Port Nord",
      serialNumber: "SN-1",
      location: "Bygg A",
    });

    const blocked = linkUnitToProduct(first.units, "unit-1", products[0]);
    expect(blocked.duplicate).toBe(true);
    expect(blocked.units).toBe(first.units);
    expect(blocked.units[0]).toMatchObject({ key: "unit-0", productId: "prod-1" });
    expect(blocked.units[1]).toMatchObject({ key: "unit-1", productId: "" });

    // Et annet registrert utstyr kan velges, uten at første rad endres.
    const second = linkUnitToProduct(blocked.units, "unit-1", products[1]);
    expect(second.duplicate).toBe(false);
    expect(second.units.map((entry) => entry.productId)).toEqual([
      "prod-1",
      "prod-2",
    ]);
    expect(second.units[0]).toEqual(blocked.units[0]);
  });

  it("tømmer bare produktkoblingen når valget fjernes", () => {
    const units = [unit("unit-0", { productId: "prod-1", label: "Port Nord" })];

    const cleared = linkUnitToProduct(units, "unit-0", null);

    expect(cleared.duplicate).toBe(false);
    expect(cleared.changed).toBe(true);
    expect(cleared.units[0]).toMatchObject({
      productId: "",
      label: "Port Nord",
    });
  });
});

describe("dedupeUnitProductIds", () => {
  it("beholder første rad og rydder senere duplikater deterministisk", () => {
    const units = [
      unit("unit-0", { productId: "prod-1" }),
      unit("unit-1", { productId: "prod-1" }),
      unit("unit-2", { productId: "prod-2" }),
      unit("unit-3", { productId: "prod-1" }),
    ];

    const result = dedupeUnitProductIds(units);

    expect(result.cleared).toBe(2);
    expect(result.units.map((entry) => entry.productId)).toEqual([
      "prod-1",
      "",
      "prod-2",
      "",
    ]);
    expect(countDuplicateUnitProductIds(units)).toBe(2);
    expect(countDuplicateUnitProductIds(result.units)).toBe(0);
  });
});
