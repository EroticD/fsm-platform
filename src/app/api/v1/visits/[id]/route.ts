import { VisitStatus, type Prisma } from "@prisma/client";
import { authenticateApiRequest } from "@/lib/api-auth";
import {
  API_RESPONSE_HEADERS,
  apiError,
  apiJson,
} from "@/lib/api-response";
import { workOrderScope, type AccessUser } from "@/lib/access";
import { toDateOnly } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import type { ServiceActor, ServiceFailure } from "@/server/actor";
import {
  assignVisit,
  deleteVisit,
  moveVisit,
  setVisitStatus,
  updateVisit,
} from "@/server/visits";

export const runtime = "nodejs";

const PATCH_FIELDS = new Set([
  "startsAt",
  "endsAt",
  "status",
  "technicianIds",
  "notes",
  "allDay",
  "sequence",
]);

const VISIT_STATUSES = Object.values(VisitStatus) as string[];

/**
 * ISO 8601 med klokkeslett. En ren dato er ikke nok for en visitt, fordi
 * start og slutt er absolutte tidspunkt og varigheten skal være entydig.
 */
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

const VISIT_SELECT = {
  id: true,
  workOrderId: true,
  sequence: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  technicians: {
    orderBy: { userId: "asc" },
    select: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.VisitSelect;

const VISIT_DETAIL_SELECT = {
  ...VISIT_SELECT,
  workOrder: {
    select: {
      id: true,
      title: true,
      orderNumber: true,
      status: true,
      scheduledFor: true,
      scheduledTo: true,
      customer: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.VisitSelect;

type VisitRow = Prisma.VisitGetPayload<{ select: typeof VISIT_SELECT }>;
type VisitDetailRow = Prisma.VisitGetPayload<{
  select: typeof VISIT_DETAIL_SELECT;
}>;

function actorForServices(actor: ServiceActor): AccessUser {
  return actor as unknown as AccessUser;
}

function toVisit(row: VisitRow) {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    sequence: row.sequence,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    status: row.status,
    notes: row.notes,
    technicians: row.technicians.map((technician) => technician.user),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVisitDetail(row: VisitDetailRow) {
  return {
    ...toVisit(row),
    workOrder: {
      id: row.workOrder.id,
      title: row.workOrder.title,
      orderNumber: row.workOrder.orderNumber,
      status: row.workOrder.status,
      scheduledFor: row.workOrder.scheduledFor
        ? toDateOnly(row.workOrder.scheduledFor)
        : null,
      scheduledTo: row.workOrder.scheduledTo
        ? toDateOnly(row.workOrder.scheduledTo)
        : null,
      customer: row.workOrder.customer ?? null,
      department: row.workOrder.department,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseDateTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ISO_DATE_TIME.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => typeof item !== "string")) return null;
  return value.map((item) => (item as string).trim()).filter(Boolean);
}

function visitError(result: ServiceFailure) {
  switch (result.reason) {
    case "forbidden":
      return apiError(
        403,
        "forbidden",
        "Du har ikke tilgang til visitten.",
        result.details,
      );
    case "not_found":
      return apiError(404, "not_found", "Fant ikke visitten.", result.details);
    case "conflict":
    case "in_use":
      return apiError(
        409,
        "conflict",
        "Visitten kan ikke endres.",
        result.details,
      );
    case "rate_limited":
      return apiError(
        429,
        "rate_limited",
        "For mange API-kall. Prøv igjen senere.",
        result.details,
      );
    case "error":
      return apiError(
        500,
        "server_error",
        "Kunne ikke oppdatere visitten.",
        result.details,
      );
    default:
      return apiError(
        422,
        "validation_error",
        "Feltene er ikke gyldige.",
        result.details,
      );
  }
}

function scopedVisitWhere(id: string, actor: ServiceActor): Prisma.VisitWhereInput {
  return {
    id,
    workOrder: { AND: [workOrderScope(actorForServices(actor))] },
  };
}

/** Én visitt, alltid slått opp gjennom oppdragets avdelings- eller kundeomfang. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.view")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til visitten.");
  }

  const { id } = await params;
  const visit = await prisma.visit.findFirst({
    where: scopedVisitWhere(id, auth.actor),
    select: VISIT_DETAIL_SELECT,
  });

  if (!visit) {
    return apiError(404, "not_found", "Fant ikke visitten.");
  }

  return apiJson(toVisitDetail(visit));
}

/**
 * Endrer én ting om gangen:
 *
 * - `startsAt` + `endsAt`: flytting, med ny overlappkontroll.
 * - `status`: statusovergang etter den felles tilstandsmaskinen.
 * - `technicianIds`: erstatter montørlisten.
 * - `notes`/`allDay`/`sequence`: metadata, som kan kombineres.
 *
 * En kropp som blander flere operasjoner avvises, slik at det aldri er tvil om
 * hvilken tjeneste som faktisk utførte endringen og hvilken revisjonslogg som
 * gjelder.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError(413, "validation_error", "Forespørselen er for stor.")
      : apiError(400, "validation_error", "Ugyldig JSON.");
  }

  const body = parsed.data;
  if (!isRecord(body)) {
    return apiError(400, "validation_error", "Body må være et JSON-objekt.");
  }

  const unknownField = Object.keys(body).find((key) => !PATCH_FIELDS.has(key));
  if (unknownField) {
    return apiError(400, "validation_error", "Ukjent felt.", {
      field: unknownField,
    });
  }

  const hasStartsAt = hasOwn(body, "startsAt");
  const hasEndsAt = hasOwn(body, "endsAt");
  const hasStatus = hasOwn(body, "status");
  const hasTechnicians = hasOwn(body, "technicianIds");
  const hasMetadata =
    hasOwn(body, "notes") || hasOwn(body, "allDay") || hasOwn(body, "sequence");
  const hasMove = hasStartsAt || hasEndsAt;

  const operationCount = [hasMove, hasStatus, hasTechnicians, hasMetadata].filter(
    Boolean,
  ).length;

  if (operationCount === 0) {
    return apiError(
      400,
      "validation_error",
      "Minst ett av feltene startsAt/endsAt, status, technicianIds, notes, allDay eller sequence må sendes.",
    );
  }
  if (operationCount > 1) {
    return apiError(
      400,
      "validation_error",
      "Bare én operasjon kan sendes om gangen.",
    );
  }

  if (hasMove && (!hasStartsAt || !hasEndsAt)) {
    return apiError(
      422,
      "validation_error",
      "startsAt og endsAt må sendes sammen.",
      {
        field: hasStartsAt ? "endsAt" : "startsAt",
        code: "visits.errors.invalidTimeRange",
      },
    );
  }

  const permission = hasMove || hasTechnicians
    ? "workorders.assign"
    : hasStatus
      ? "workorders.update"
      : "workorders.edit";
  if (!hasPermission(auth.actor, permission)) {
    return apiError(
      403,
      "forbidden",
      "Du har ikke tilgang til å endre visitten.",
    );
  }

  const { id } = await params;

  if (hasMove) {
    const startsAt = parseDateTime(body.startsAt);
    if (!startsAt) {
      return apiError(422, "validation_error", "Ugyldig starttidspunkt.", {
        field: "startsAt",
      });
    }
    const endsAt = parseDateTime(body.endsAt);
    if (!endsAt) {
      return apiError(422, "validation_error", "Ugyldig sluttidspunkt.", {
        field: "endsAt",
      });
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      return apiError(422, "validation_error", "Slutt må være etter start.", {
        field: "endsAt",
        code: "visits.errors.invalidTimeRange",
      });
    }

    const result = await moveVisit(auth.actor, id, { startsAt, endsAt });
    if (!result.ok) return visitError(result);
  } else if (hasStatus) {
    if (
      typeof body.status !== "string" ||
      !VISIT_STATUSES.includes(body.status)
    ) {
      return apiError(422, "validation_error", "Ugyldig status.", {
        field: "status",
        code: "visits.errors.statusTransition",
      });
    }

    const result = await setVisitStatus(
      auth.actor,
      id,
      body.status as VisitStatus,
    );
    if (!result.ok) return visitError(result);
  } else if (hasTechnicians) {
    const technicianIds = readStringList(body.technicianIds);
    if (technicianIds === null) {
      return apiError(
        422,
        "validation_error",
        "technicianIds må være en liste med id-er.",
        { field: "technicianIds" },
      );
    }

    const result = await assignVisit(auth.actor, id, technicianIds);
    if (!result.ok) return visitError(result);
  } else {
    const input: {
      notes?: string | null;
      sequence?: number;
      allDay?: boolean;
    } = {};

    if (hasOwn(body, "notes")) {
      if (body.notes !== null && typeof body.notes !== "string") {
        return apiError(422, "validation_error", "notes må være tekst.", {
          field: "notes",
        });
      }
      input.notes = body.notes as string | null;
    }
    if (hasOwn(body, "allDay")) {
      if (typeof body.allDay !== "boolean") {
        return apiError(422, "validation_error", "allDay må være boolsk.", {
          field: "allDay",
        });
      }
      input.allDay = body.allDay;
    }
    if (hasOwn(body, "sequence")) {
      if (
        typeof body.sequence !== "number" ||
        !Number.isInteger(body.sequence) ||
        body.sequence < 0
      ) {
        return apiError(
          422,
          "validation_error",
          "sequence må være et heltall.",
          { field: "sequence", code: "visits.errors.invalidSequence" },
        );
      }
      input.sequence = body.sequence;
    }

    const result = await updateVisit(auth.actor, id, input);
    if (!result.ok) return visitError(result);
  }

  // Tjenestene returnerer bare visittraden. Hent den på nytt gjennom samme
  // omfang, slik at svaret har montører og oppdragssammendrag på samme form
  // som GET /visits/{id}.
  const updated = await prisma.visit.findFirst({
    where: scopedVisitWhere(id, auth.actor),
    select: VISIT_DETAIL_SELECT,
  });
  if (!updated) {
    return apiError(404, "not_found", "Fant ikke visitten.");
  }

  return apiJson(toVisitDetail(updated));
}

/** Sletter visitten. Oppdraget og revisjonsloggen består. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.edit")) {
    return apiError(
      403,
      "forbidden",
      "Du har ikke tilgang til å slette visitten.",
    );
  }

  const { id } = await params;
  const result = await deleteVisit(auth.actor, id);
  if (!result.ok) return visitError(result);

  return new Response(null, {
    status: 204,
    headers: API_RESPONSE_HEADERS,
  });
}
