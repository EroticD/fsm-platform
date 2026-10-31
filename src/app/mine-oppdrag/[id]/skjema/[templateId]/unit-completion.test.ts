import { describe, expect, it } from "vitest";
import type { UnitEntry } from "./draft-restore";
import {
  applyUnitStatus,
  completionUndoReducer,
  evaluateUnitCompletion,
  undoUnitStatus,
  type CompletionField,
  type CompletionUndoState,
} from "./unit-completion";

function unit(overrides: Partial<UnitEntry> = {}): UnitEntry {
  return {
    key: "unit-0",
    productId: "",
    label: "Port Nord",
    serialNumber: "",
    location: "",
    status: "UNASSESSED",
    comment: "",
    answers: {},
    ...overrides,
  };
}

const fields: CompletionField[] = [
  { id: "f1", type: "TEXT", label: "Tilstand", required: true },
  { id: "f2", type: "IMAGE", label: "Bilde", required: true },
  { id: "f3", type: "STATUS", label: "Status", required: true },
  {
    id: "f4",
    type: "TEXT",
    label: "Avviksbeskrivelse",
    required: true,
    conditionalFieldId: "f3",
    conditionalValue: "Avvik",
  },
];

describe("evaluateUnitCompletion", () => {
  it("godkjenner når alle synlige, påkrevde sjekkpunkter er besvart", () => {
    const result = evaluateUnitCompletion({
      unit: unit({ answers: { f1: "OK", f3: "OK" } }),
      fields,
      imageCounts: { f2: 1 },
    });

    expect(result).toEqual({ ok: true });
  });

  it("ignorerer påkrevde felt som er skjult av en betingelse", () => {
    const result = evaluateUnitCompletion({
      unit: unit({ answers: { f1: "OK", f3: "OK" } }),
      fields,
      imageCounts: { f2: 1 },
    });

    // f4 er påkrevd, men bare synlig når f3 er «Avvik».
    expect(result.ok).toBe(true);
  });

  it("teller opp manglende svar med feltnavn", () => {
    const result = evaluateUnitCompletion({
      unit: unit({ answers: { f1: "", f3: "OK" } }),
      fields,
      imageCounts: { f2: 0 },
    });

    expect(result).toEqual({
      ok: false,
      blocker: {
        kind: "incomplete",
        missing: [
          { fieldId: "f1", label: "Tilstand" },
          { fieldId: "f2", label: "Bilde" },
        ],
        triggers: [],
      },
    });
  });

  it("bruker opplastet bildetelling selv om answers fortsatt er tom", () => {
    const result = evaluateUnitCompletion({
      unit: unit({ answers: { f1: "OK", f3: "OK", f2: "[]" } }),
      fields,
      imageCounts: { f2: 2 },
    });

    expect(result.ok).toBe(true);
  });

  it("krever at en påkrevd avkrysningsboks faktisk er krysset av", () => {
    const checkboxFields: CompletionField[] = [
      { id: "f5", type: "CHECKBOX", label: "Sikkerhet", required: true },
    ];

    expect(
      evaluateUnitCompletion({
        unit: unit({ answers: { f5: "false" } }),
        fields: checkboxFields,
      }).ok,
    ).toBe(false);
    expect(
      evaluateUnitCompletion({
        unit: unit({ answers: { f5: "true" } }),
        fields: checkboxFields,
      }).ok,
    ).toBe(true);
  });

  it("blokkerer når et synlig tilstandsfelt står på et avviksvalg", () => {
    const result = evaluateUnitCompletion({
      unit: unit({
        answers: { f1: "OK", f2: '["/uploads/a.jpg"]', f3: "Avvik", f4: "Dør" },
      }),
      fields,
    });

    expect(result).toEqual({
      ok: false,
      blocker: {
        kind: "incomplete",
        missing: [],
        triggers: [
          { fieldId: "f3", label: "Status", value: "Avvik" },
        ],
      },
    });
  });

  it("gjør ingenting når enheten allerede er godkjent", () => {
    expect(
      evaluateUnitCompletion({
        unit: unit({ status: "GODKJENT", answers: {} }),
        fields,
      }),
    ).toEqual({ ok: false, blocker: { kind: "status-approved" } });
  });

  it("overskriver aldri et avvik uten eksplisitt radiovalg", () => {
    expect(
      evaluateUnitCompletion({
        unit: unit({ status: "AVVIK", answers: {} }),
        fields,
      }),
    ).toEqual({ ok: false, blocker: { kind: "status-deviation" } });
  });
});

describe("angre av hurtigfullføring", () => {
  it("tilbyr, rydder og utløper én angre-oppføring", () => {
    const empty: CompletionUndoState = { undo: null };
    const offered = completionUndoReducer(empty, {
      type: "offer",
      undo: { unitKey: "unit-0", previousStatus: "UNASSESSED" },
    });

    expect(offered.undo).toEqual({
      unitKey: "unit-0",
      previousStatus: "UNASSESSED",
    });
    expect(completionUndoReducer(offered, { type: "clear" })).toEqual({
      undo: null,
    });
    expect(completionUndoReducer(offered, { type: "expire" })).toEqual({
      undo: null,
    });
    // En ny fullføring erstatter den forrige, så toasten alltid gjelder siste rad.
    const replaced = completionUndoReducer(offered, {
      type: "offer",
      undo: { unitKey: "unit-1", previousStatus: "UNASSESSED" },
    });
    expect(replaced.undo?.unitKey).toBe("unit-1");
  });

  it("gjenoppretter nøyaktig statusen enheten hadde før fullføring", () => {
    const units = [unit({ status: "UNASSESSED" })];
    const approved = applyUnitStatus(units, "unit-0", "GODKJENT");

    expect(approved[0].status).toBe("GODKJENT");
    expect(
      undoUnitStatus(approved, {
        unitKey: "unit-0",
        previousStatus: "UNASSESSED",
      })[0].status,
    ).toBe("UNASSESSED");
  });

  it("kan gjenopprette en vilkårlig forrige status uten å røre andre rader", () => {
    const units = [
      unit({ key: "unit-0", status: "GODKJENT" }),
      unit({ key: "unit-1", status: "AVVIK" }),
    ];
    const restored = undoUnitStatus(units, {
      unitKey: "unit-0",
      previousStatus: "AVVIK",
    });

    expect(restored[0].status).toBe("AVVIK");
    expect(restored[1].status).toBe("AVVIK");
  });
});
