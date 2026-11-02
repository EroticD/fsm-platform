import { describe, expect, it } from "vitest";
import {
  buildEquipmentListHref,
  matchesEquipmentFilters,
  type EquipmentFilterItem,
  type EquipmentFilterState,
} from "./equipment-list-filters";

const filters: EquipmentFilterState = {
  query: "pumpe",
  status: "ACTIVE",
  categoryId: "cat-1",
  customerId: "cust-1",
  hierarchy: true,
};

const item: EquipmentFilterItem = {
  status: "ACTIVE",
  categoryId: "cat-1",
  customerId: "cust-1",
  model: "Pumpe 200",
  serialNumber: "SN-1",
  location: "Kjeller",
  customer: { name: "Kunde AS" },
  category: { name: "Pumper" },
};

describe("equipment-list-filters", () => {
  it("beholder kundefilteret gjennom søk, side og hierarki", () => {
    const href = buildEquipmentListHref(filters, 3);
    const params = new URL(href, "https://example.test").searchParams;

    expect(params.get("kunde")).toBe("cust-1");
    expect(params.get("q")).toBe("pumpe");
    expect(params.get("status")).toBe("ACTIVE");
    expect(params.get("kategori")).toBe("cat-1");
    expect(params.get("hierarki")).toBe("1");
    expect(params.get("side")).toBe("3");
  });

  it("utelater tomme filtre og første side", () => {
    expect(
      buildEquipmentListHref({
        query: "",
        status: "",
        categoryId: "",
        customerId: "",
        hierarchy: false,
      }),
    ).toBe("/enheter");
  });

  it("matcher kunde, status, kategori og fritekst i hierarkiet", () => {
    expect(matchesEquipmentFilters(item, filters)).toBe(true);

    expect(
      matchesEquipmentFilters(item, { ...filters, customerId: "cust-2" }),
    ).toBe(false);
    expect(
      matchesEquipmentFilters(item, { ...filters, status: "RETIRED" }),
    ).toBe(false);
    expect(
      matchesEquipmentFilters(item, { ...filters, categoryId: "cat-2" }),
    ).toBe(false);
    expect(
      matchesEquipmentFilters(
        { ...item, model: "Ventil" },
        { ...filters, query: "finnesikke" },
      ),
    ).toBe(false);
  });

  it("søker uten hensyn til store og små bokstaver", () => {
    expect(
      matchesEquipmentFilters(
        { ...item, customer: { name: "Årlig Service" } },
        { ...filters, query: "ÅRLIG" },
      ),
    ).toBe(true);
  });
});
