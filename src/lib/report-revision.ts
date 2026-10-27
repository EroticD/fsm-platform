import type { HmsFormType } from "@prisma/client";
import {
  REPORT_STATUS_WITHOUT_UNITS,
  parseJsonObject,
  reportStatus,
} from "@/lib/report-answers";

/**
 * Hjelpere for revisjonsøyeblikksbilder.
 *
 * En revisjon lagrer rapporten slik den var *før* en endring. Feltene er rå
 * JSON-strenger, og alle hjelperne her feiler lukket: ukjent eller ødelagt
 * innhold gir tomme lister/objekter i stedet for å kaste.
 */

export type RevisionUnitSnapshot = {
  id: string;
  label: string;
  serialNumber: string | null;
  location: string | null;
  status: string;
  answersJson: string;
  comment: string | null;
  sortOrder: number;
};

export type RevisionSnapshotSource = {
  id: string;
  revision: number;
  dataJson: string;
  unitsJson?: string | null;
  comments?: string | null;
  templateTitle?: string | null;
  name?: string | null;
  reportNumber?: string | null;
  requiresUnits?: boolean | null;
  templateCategory?: "SERVICE" | "HMS" | null;
  hmsType?: HmsFormType | null;
  completedAt?: Date | string | null;
  templateSnapshotJson?: string | null;
  technicianSignatureUrl?: string | null;
  technicianName?: string | null;
  customerSignatureUrl?: string | null;
  customerName?: string | null;
  customerAcknowledgedAt?: Date | string | null;
  customerAcknowledgedBy?: string | null;
  customerAcknowledgedComment?: string | null;
  reason?: string | null;
  createdById?: string | null;
  createdAt?: Date | string | null;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Leser enhetslisten fra revisjonens `unitsJson` uten å stole på formen. */
export function parseRevisionUnits(
  raw: string | null | undefined,
): RevisionUnitSnapshot[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (unit): unit is Record<string, unknown> =>
          Boolean(unit) && typeof unit === "object",
      )
      .map((unit, index) => ({
        id: typeof unit.id === "string" ? unit.id : `revisjon-enhet-${index}`,
        label: typeof unit.label === "string" ? unit.label : "",
        serialNumber: textOrNull(unit.serialNumber),
        location: textOrNull(unit.location),
        status:
          unit.status === "AVVIK" ||
          unit.status === REPORT_STATUS_WITHOUT_UNITS
            ? unit.status
            : "GODKJENT",
        answersJson:
          typeof unit.answersJson === "string" ? unit.answersJson : "{}",
        comment: textOrNull(unit.comment),
        sortOrder:
          typeof unit.sortOrder === "number" ? unit.sortOrder : index,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return [];
  }
}

/**
 * Statusen revisjonen hadde. Revisjoner uten enheter har ingen godkjenning
 * eller avvik, uansett hva som ble lagret i eldre `dataJson`.
 */
export function revisionStatus(
  revision: Pick<RevisionSnapshotSource, "dataJson" | "requiresUnits">,
): string {
  if (revision.requiresUnits === false) return REPORT_STATUS_WITHOUT_UNITS;
  return reportStatus(revision.dataJson);
}

/** Svarfeltene for en revisjon uten enheter ligger i `dataJson.answers`. */
export function revisionLegacyAnswers(
  revision: Pick<RevisionSnapshotSource, "dataJson">,
): Record<string, unknown> {
  const answers = parseJsonObject(revision.dataJson).answers;
  return answers && typeof answers === "object" && !Array.isArray(answers)
    ? (answers as Record<string, unknown>)
    : {};
}

/** Malens felt slik de så ut da revisjonen ble laget. */
export function revisionFields(
  revision: Pick<RevisionSnapshotSource, "templateSnapshotJson">,
): Array<Record<string, unknown>> {
  if (!revision.templateSnapshotJson) return [];
  try {
    const parsed = JSON.parse(revision.templateSnapshotJson);
    return Array.isArray(parsed)
      ? parsed.filter(
          (field): field is Record<string, unknown> =>
            Boolean(field) && typeof field === "object",
        )
      : [];
  } catch {
    return [];
  }
}

/** Rapporten slik `ReportDocument` forventer den. */
export function revisionToDocumentReport(revision: RevisionSnapshotSource) {
  return {
    id: revision.id,
    templateTitle: revision.templateTitle ?? null,
    name: revision.name ?? null,
    reportNumber: revision.reportNumber ?? null,
    requiresUnits: revision.requiresUnits !== false,
    templateCategory: revision.templateCategory === "HMS" ? "HMS" : "SERVICE",
    hmsType: revision.hmsType ?? null,
    templateSnapshotJson: revision.templateSnapshotJson ?? null,
    dataJson: revision.dataJson,
    comments: revision.comments ?? null,
    createdAt: revision.completedAt ?? revision.createdAt ?? null,
    units: parseRevisionUnits(revision.unitsJson).map((unit) => ({
      id: unit.id,
      label: unit.label,
      serialNumber: unit.serialNumber,
      location: unit.location,
      status: unit.status,
      answersJson: unit.answersJson,
      comment: unit.comment,
    })),
    technicianSignatureUrl: revision.technicianSignatureUrl ?? null,
    technicianName: revision.technicianName ?? null,
    customerSignatureUrl: revision.customerSignatureUrl ?? null,
    customerName: revision.customerName ?? null,
    customerAcknowledgedAt: revision.customerAcknowledgedAt ?? null,
    customerAcknowledgedBy: revision.customerAcknowledgedBy ?? null,
    customerAcknowledgedComment: revision.customerAcknowledgedComment ?? null,
  };
}

/** Hele `data`-objektet til PDF-komponenten, bygget kun fra øyeblikksbildet. */
export function revisionToDocumentData(
  workOrder: {
    id?: string;
    title?: string | null;
    orderNumber?: string | null;
    status?: string | null;
    scheduledFor?: Date | string | null;
    customer?: { name?: string | null } | null;
  },
  revision: RevisionSnapshotSource,
) {
  return {
    workOrder: {
      ...workOrder,
      // Malen er frosset i revisjonen; den levende malen skal ikke brukes.
      templates: [],
      reports: undefined,
    },
    reports: [revisionToDocumentReport(revision)],
  };
}
