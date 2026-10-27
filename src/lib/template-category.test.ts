import { describe, expect, it } from "vitest";
import {
  TEMPLATE_CATEGORIES,
  hmsTypeLabelKey,
  isTemplateCategory,
  parseTemplateCategoryFilter,
  resolveTemplateClassification,
} from "./template-category";

describe("malkategori – rene hjelpere", () => {
  it("kjenner de to kategoriene", () => {
    expect([...TEMPLATE_CATEGORIES]).toEqual(["SERVICE", "HMS"]);
    expect(isTemplateCategory("SERVICE")).toBe(true);
    expect(isTemplateCategory("HMS")).toBe(true);
    expect(isTemplateCategory("service")).toBe(false);
    expect(isTemplateCategory(undefined)).toBe(false);
  });

  it("filtrerer bare på kjente kategorier", () => {
    expect(parseTemplateCategoryFilter("HMS")).toBe("HMS");
    expect(parseTemplateCategoryFilter("SERVICE")).toBe("SERVICE");
    expect(parseTemplateCategoryFilter("hms")).toBeNull();
    expect(parseTemplateCategoryFilter("")).toBeNull();
    expect(parseTemplateCategoryFilter(undefined)).toBeNull();
  });

  it("bruker SERVICE når kategori mangler", () => {
    expect(
      resolveTemplateClassification({ defaultCategory: "SERVICE" }),
    ).toEqual({ category: "SERVICE", hmsType: null });
    expect(resolveTemplateClassification({})).toEqual({
      category: "SERVICE",
      hmsType: null,
    });
  });

  it("tvinger hmsType til null for service-maler", () => {
    expect(
      resolveTemplateClassification({ category: "SERVICE", hmsType: "SJA" }),
    ).toEqual({ category: "SERVICE", hmsType: null });
  });

  it("krever gyldig HMS-type for HMS-maler", () => {
    expect(
      resolveTemplateClassification({ category: "HMS", hmsType: "SJA" }),
    ).toEqual({ category: "HMS", hmsType: "SJA" });
    expect(
      resolveTemplateClassification({ category: "HMS", hmsType: "  DEVIATION  " }),
    ).toEqual({ category: "HMS", hmsType: "DEVIATION" });

    for (const hmsType of [undefined, null, "", "UKJENT", "sja", 42]) {
      expect(
        resolveTemplateClassification({ category: "HMS", hmsType }),
      ).toBeNull();
    }
  });

  it("avviser ukjent kategori", () => {
    expect(
      resolveTemplateClassification({ category: "ANNET", hmsType: "SJA" }),
    ).toBeNull();
  });

  it("beholder standardkategorien når kategori er tom", () => {
    expect(
      resolveTemplateClassification({
        category: "  ",
        hmsType: "SJA",
        defaultCategory: "HMS",
      }),
    ).toEqual({ category: "HMS", hmsType: "SJA" });
  });

  it("gir oversettelsesnøkkel per HMS-type", () => {
    expect(hmsTypeLabelKey("SJA")).toBe("settings.templates.hmsTypes.SJA");
  });
});
