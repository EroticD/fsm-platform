/**
 * Ren logikk for «fullfør enheten» – både sveipingen på mobil og den vanlige
 * knappen. Reglene ligger utenfor komponenten slik at skjemaet, testene og en
 * fremtidig hurtigvei vurderer nøyaktig de samme kravene.
 *
 * En enhet kan bare godkjennes når alle synlige, påkrevde sjekkpunkter er
 * besvart, og ingen synlig tilstandsfelt står på et valg som krever oppfølging.
 * Da kan heller ikke en sveip omgå de samme kontrollene som skjemaet krever.
 */

import {
  commentTriggerOptions,
  parseImageUrls,
} from "@/lib/report-answers";
import type { UnitEntry, UnitStatus } from "./draft-restore";

export type CompletionField = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  /** For tilstandsfelt: valgene som krever kommentar/oppfølging. */
  commentOptions?: string[];
  conditionalFieldId?: string;
  conditionalValue?: string;
};

/** Sammenligner et svar med malens betingelsesverdi, uten hensyn til case. */
export function answerMatches(
  value: unknown,
  expected: string | undefined,
): boolean {
  if (expected === undefined) return true;
  const raw = (value === undefined || value === null ? "" : String(value))
    .trim()
    .toLowerCase();
  const wanted = expected.trim().toLowerCase();
  if (raw === wanted) return true;
  // Avkrysningsfelt lagres som «true»/«false», men malbyggeren kan ha skrevet
  // «Ja»/«Nei» som betingelse. Godta begge skrivemåtene.
  const truthy = ["true", "ja", "yes", "1"];
  const falsy = ["false", "nei", "no", "0"];
  return (
    (truthy.includes(raw) && truthy.includes(wanted)) ||
    (falsy.includes(raw) && falsy.includes(wanted))
  );
}

/**
 * Er feltet synlig ut fra svarene i samme enhet? Betingede felt blir først
 * vist når kildefeltet har verdien malen krever.
 */
export function isFieldVisible(
  field: CompletionField,
  answers: Record<string, unknown>,
): boolean {
  if (!field.conditionalFieldId) return true;
  return answerMatches(answers[field.conditionalFieldId], field.conditionalValue);
}

/** Et sjekkpunkt teller som besvart når feltet har en faktisk verdi. */
export function hasAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/**
 * Påkrevde felt må ha et reelt svar. Avkrysningsbokser må være krysset av, og
 * bildefelt må ha minst ett opplastet bilde – en tom JSON-liste er ikke svar.
 */
function hasCompletionAnswer(
  field: CompletionField,
  value: unknown,
  imageCount: number | undefined,
): boolean {
  if (field.type === "IMAGE") {
    return (imageCount ?? parseImageUrls(value).length) > 0;
  }
  if (field.type === "CHECKBOX") {
    return value === true || value === "true" || value === "on";
  }
  return hasAnswer(value);
}

export type MissingAnswer = { fieldId: string; label: string };
export type DeviationTrigger = {
  fieldId: string;
  label: string;
  value: string;
};

export type UnitCompletionBlocker =
  | { kind: "status-approved" }
  | { kind: "status-deviation" }
  | { kind: "unit-label" }
  | {
      kind: "incomplete";
      missing: MissingAnswer[];
      triggers: DeviationTrigger[];
    };

export type UnitCompletionCheck =
  | { ok: true }
  | { ok: false; blocker: UnitCompletionBlocker };

/**
 * Vurderer om enheten kan godkjennes med ett trykk/sveip. `imageCounts` er
 * antall ferdig opplastede bilder per felt-id, fordi bildefeltet holder tellingen
 * utenfor `answers` mens opplastingen pågår.
 */
export function evaluateUnitCompletion({
  unit,
  fields,
  imageCounts = {},
}: {
  unit: Pick<UnitEntry, "status" | "answers" | "label">;
  fields: CompletionField[];
  imageCounts?: Record<string, number>;
}): UnitCompletionCheck {
  if (unit.status === "GODKJENT") {
    return { ok: false, blocker: { kind: "status-approved" } };
  }
  if (unit.status === "AVVIK") {
    return { ok: false, blocker: { kind: "status-deviation" } };
  }
  // Enheten må kunne identifiseres i rapporten. Skjemaet krever enhetsnavn ved
  // innsending; hurtigfullføring skal ikke omgå det kravet.
  if (unit.label.trim() === "") {
    return { ok: false, blocker: { kind: "unit-label" } };
  }

  const missing: MissingAnswer[] = [];
  const triggers: DeviationTrigger[] = [];

  for (const field of fields) {
    if (!isFieldVisible(field, unit.answers)) continue;
    const value = unit.answers[field.id];

    // Et avviksvalg skal aldri kunne bli en stille godkjenning.
    if (
      field.type === "STATUS" &&
      typeof value === "string" &&
      commentTriggerOptions(field).includes(value)
    ) {
      triggers.push({ fieldId: field.id, label: field.label, value });
    }

    if (
      field.required &&
      !hasCompletionAnswer(field, value, imageCounts[field.id])
    ) {
      missing.push({ fieldId: field.id, label: field.label });
    }
  }

  if (missing.length > 0 || triggers.length > 0) {
    return {
      ok: false,
      blocker: { kind: "incomplete", missing, triggers },
    };
  }

  return { ok: true };
}

/** En angre-oppføring husker nøyaktig statusen enheten hadde før godkjenningen. */
export type UnitStatusUndo = {
  unitKey: string;
  previousStatus: UnitStatus;
};

export type CompletionUndoState = { undo: UnitStatusUndo | null };

export type CompletionUndoAction =
  | { type: "offer"; undo: UnitStatusUndo }
  | { type: "clear" }
  | { type: "expire" };

/** Holder bare den ene angre-oppføringen som toasten kan vise. */
export function completionUndoReducer(
  state: CompletionUndoState,
  action: CompletionUndoAction,
): CompletionUndoState {
  switch (action.type) {
    case "offer":
      return { undo: action.undo };
    case "clear":
    case "expire":
      return state.undo === null ? state : { undo: null };
    default:
      return state;
  }
}

/** Setter status på én enhet uten å røre de andre radene. */
export function applyUnitStatus(
  units: UnitEntry[],
  unitKey: string,
  status: UnitStatus,
): UnitEntry[] {
  return units.map((unit) =>
    unit.key === unitKey && unit.status !== status
      ? { ...unit, status }
      : unit,
  );
}

/** Gjenoppretter den eksakte statusen som ble lagret i angre-oppføringen. */
export function undoUnitStatus(
  units: UnitEntry[],
  undo: UnitStatusUndo,
): UnitEntry[] {
  return applyUnitStatus(units, undo.unitKey, undo.previousStatus);
}

/** Beskrivelsen som vises inline når en sveip/knapp ikke kan fullføre. */
export type UnitCompletionNotice =
  | { kind: "unit-label" }
  | { kind: "missing"; count: number; fields: string[] }
  | {
      kind: "trigger";
      field: string;
      value: string;
      /** Påkrevde felt som også mangler svar, så begge kravene forklares. */
      missingCount?: number;
      missingFields?: string[];
    }
  | { kind: "deviation" };
