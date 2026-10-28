import { describe, expect, it } from "vitest";
import { cleanTemplateFieldsJson } from "./template-fields";

describe("cleanTemplateFieldsJson – betingede felt", () => {
  it("beholder conditionalFieldId og conditionalValue gjennom en runde", () => {
    const raw = JSON.stringify([
      { id: "trigger", type: "SELECT", label: "Avvik?", options: ["Ja", "Nei"] },
      {
        id: "details",
        type: "TEXTAREA",
        label: "Beskriv avviket",
        required: true,
        conditionalFieldId: "trigger",
        conditionalValue: "Ja",
      },
    ]);

    const cleaned = JSON.parse(cleanTemplateFieldsJson(raw)) as Array<
      Record<string, unknown>
    >;

    expect(cleaned[1]).toMatchObject({
      id: "details",
      conditionalFieldId: "trigger",
      conditionalValue: "Ja",
    });
  });

  it("fjerner betingelser som peker på et felt som ikke finnes", () => {
    const raw = JSON.stringify([
      {
        id: "details",
        type: "TEXT",
        label: "Detaljer",
        conditionalFieldId: "slettet-felt",
        conditionalValue: "Ja",
      },
    ]);

    const [field] = JSON.parse(cleanTemplateFieldsJson(raw)) as Array<
      Record<string, unknown>
    >;

    expect(field).not.toHaveProperty("conditionalFieldId");
    expect(field).not.toHaveProperty("conditionalValue");
  });

  it("avviser selvreferanse og ugyldige id-er", () => {
    const raw = JSON.stringify([
      {
        id: "details",
        type: "TEXT",
        label: "Detaljer",
        conditionalFieldId: "details",
        conditionalValue: "Ja",
      },
      {
        id: "other",
        type: "TEXT",
        label: "Annet",
        conditionalFieldId: "../etc/passwd",
        conditionalValue: "Ja",
      },
    ]);

    const fields = JSON.parse(cleanTemplateFieldsJson(raw)) as Array<
      Record<string, unknown>
    >;

    expect(fields.every((field) => !("conditionalFieldId" in field))).toBe(true);
  });
});
