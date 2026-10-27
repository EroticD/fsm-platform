import { describe, expect, it } from "vitest";
import {
  isHmsReport,
  isHmsTemplate,
  reportTemplateCategoryOf,
  splitTemplatesByCategory,
  templateCategoryOf,
} from "./template-categories";

describe("template-categories", () => {
  it("behandler manglende og ukjent kategori som service", () => {
    expect(templateCategoryOf(null)).toBe("SERVICE");
    expect(templateCategoryOf({})).toBe("SERVICE");
    expect(templateCategoryOf({ category: "SERVICE" })).toBe("SERVICE");
    expect(reportTemplateCategoryOf(null)).toBe("SERVICE");
    expect(reportTemplateCategoryOf({})).toBe("SERVICE");
  });

  it("gjenkjenner HMS-maler og HMS-rapporter", () => {
    expect(isHmsTemplate({ category: "HMS" })).toBe(true);
    expect(isHmsReport({ templateCategory: "HMS" })).toBe(true);
    expect(isHmsTemplate({ category: "SERVICE" })).toBe(false);
    expect(isHmsReport({ templateCategory: "SERVICE" })).toBe(false);
  });

  it("deler maler i service og HMS uten å endre rekkefølgen", () => {
    const templates = [
      { id: "a", category: "SERVICE" as const },
      { id: "b", category: "HMS" as const },
      { id: "c", category: null },
      { id: "d", category: "HMS" as const },
    ];

    const { service, hms } = splitTemplatesByCategory(templates);

    expect(service.map((template) => template.id)).toEqual(["a", "c"]);
    expect(hms.map((template) => template.id)).toEqual(["b", "d"]);
  });
});
