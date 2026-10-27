import { describe, expect, it } from "vitest";
import {
  HMS_FORM_GROUPS,
  HMS_FORM_TYPES,
  HMS_TEMPLATE_DEFINITIONS,
  isHmsFormType,
} from "./hms";
import { cleanTemplateFieldsJson } from "./template-fields";

describe("HMS-standardmaler", () => {
  it("har alle seks standardskjemaene med unike id-er", () => {
    expect(HMS_TEMPLATE_DEFINITIONS).toHaveLength(6);
    expect(new Set(HMS_TEMPLATE_DEFINITIONS.map((template) => template.id)).size).toBe(6);
    expect(new Set(HMS_TEMPLATE_DEFINITIONS.map((template) => template.hmsType))).toEqual(
      new Set([
        "SJA",
        "HOT_WORK",
        "INTERNAL_CONTROL",
        "DEVIATION",
        "SAFETY_ROUND",
        "WRITTEN_INSTRUCTION",
      ]),
    );
  });

  it("bruker gyldige HMS-typer og felt som overlever rensing", () => {
    for (const template of HMS_TEMPLATE_DEFINITIONS) {
      expect(isHmsFormType(template.hmsType)).toBe(true);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.reportName.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.fields.length).toBeGreaterThan(20);
      expect(template.fields.length).toBeLessThanOrEqual(100);

      const ids = template.fields.map((field) => field.id);
      expect(new Set(ids).size).toBe(ids.length);

      const cleaned = JSON.parse(cleanTemplateFieldsJson(template.fields)) as Array<{
        id: string;
      }>;
      expect(cleaned).toHaveLength(template.fields.length);
      expect(new Set(cleaned.map((field) => field.id))).toEqual(new Set(ids));
    }
  });

  it("har en visningsgruppe for hver HMS-type", () => {
    expect(new Set(HMS_FORM_GROUPS.map((group) => group.type))).toEqual(
      new Set(HMS_FORM_TYPES),
    );
  });
});
