/**
 * Ren logikk for å gjenopprette en lokal kladd inn i skjemaet.
 *
 * Skjemaet bruker ukontrollerte felter (defaultValue/defaultChecked), så en
 * kladd som bare oppdaterte React-state kunne gi et skjema der det montøren så
 * avvek fra det som faktisk ble sendt inn. Her bygges både enhetsstate og et
 * fullt startobjekt (notater, navn og signaturer) fra samme øyeblikksbilde, slik
 * at alle felter kan rendres på nytt med de gjenopprettede verdiene.
 */

export type UnitEntry = {
  key: string;
  productId: string;
  label: string;
  serialNumber: string;
  location: string;
  status: "GODKJENT" | "AVVIK";
  comment: string;
  answers: Record<string, unknown>;
};

export type ReportFormState = {
  counter: number;
  units: UnitEntry[];
};

export type ReportSeed = {
  notes: string;
  technicianSignatureUrl: string | null;
  technicianName: string | null;
  customerSignatureUrl: string | null;
  customerName: string | null;
  units: Omit<UnitEntry, "key">[];
};

/**
 * Øyeblikksbildet som lagres i IndexedDB. `form` er skjemaets FormData
 * serialisert, og er autoritativ for tekstfelter. `state` trengs i tillegg for
 * enhetsstruktur, betingede felt og verdier komponentene holder internt.
 */
export type LocalDraftSnapshot = {
  state?: ReportFormState;
  form?: Record<string, string>;
  notes?: string;
};

export const REPORT_WITHOUT_UNITS_KEY = "report";

export function makeUnit(
  key: string,
  from?: Partial<UnitEntry> | null,
): UnitEntry {
  return {
    key,
    productId: from?.productId ?? "",
    label: from?.label ?? "",
    serialNumber: from?.serialNumber ?? "",
    location: from?.location ?? "",
    status: from?.status === "AVVIK" ? "AVVIK" : "GODKJENT",
    comment: from?.comment ?? "",
    answers: from?.answers ?? {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeState(
  snapshot: LocalDraftSnapshot,
  requiresUnits: boolean,
): ReportFormState | null {
  const raw = snapshot.state;
  if (!raw || !Array.isArray(raw.units)) return null;

  if (!requiresUnits) {
    const first = raw.units[0];
    return {
      counter: 1,
      units: [
        makeUnit(REPORT_WITHOUT_UNITS_KEY, {
          status: first?.status,
          comment: first?.comment,
          answers: first?.answers,
        }),
      ],
    };
  }

  const units = raw.units
    .filter((unit): unit is UnitEntry => isRecord(unit))
    .map((unit, index) =>
      makeUnit(
        typeof unit.key === "string" && unit.key ? unit.key : `unit-${index}`,
        unit,
      ),
    );

  return {
    counter:
      typeof raw.counter === "number" && raw.counter > units.length
        ? raw.counter
        : units.length,
    units,
  };
}

function formValue(
  form: Record<string, string> | undefined,
  key: string,
): string | undefined {
  const value = form?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Slår sammen en lokal kladd med en eventuell eldre serverkladd/rapport.
 * Lokale verdier vinner, men felter som ikke finnes lokalt beholder serverens
 * verdi. Returnerer null når kladden ikke inneholder brukbar state.
 */
export function restoreLocalDraft(input: {
  snapshot: LocalDraftSnapshot;
  requiresUnits: boolean;
  fallback?: ReportSeed;
}): { state: ReportFormState; seed: ReportSeed } | null {
  const state = normalizeState(input.snapshot, input.requiresUnits);
  if (!state) return null;

  const { snapshot, fallback } = input;
  const form = snapshot.form;
  const notes =
    formValue(form, "notes") ?? snapshot.notes ?? fallback?.notes ?? "";

  return {
    state,
    seed: {
      notes,
      technicianSignatureUrl:
        formValue(form, "technicianSignature") ||
        fallback?.technicianSignatureUrl ||
        null,
      technicianName:
        formValue(form, "technicianName") ?? fallback?.technicianName ?? null,
      customerSignatureUrl:
        formValue(form, "customerSignature") ||
        fallback?.customerSignatureUrl ||
        null,
      customerName:
        formValue(form, "customerName") ?? fallback?.customerName ?? null,
      units: state.units.map((unit) => ({
        productId: unit.productId,
        label: unit.label,
        serialNumber: unit.serialNumber,
        location: unit.location,
        status: unit.status,
        comment: unit.comment,
        answers: unit.answers,
      })),
    },
  };
}
