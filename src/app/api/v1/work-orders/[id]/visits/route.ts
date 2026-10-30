import type { Prisma } from "@prisma/client";
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { workOrderScope, type AccessUser } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import type { ServiceActor, ServiceFailure } from "@/server/actor";
import { createVisit } from "@/server/visits";

export const runtime = "nodejs";

const CREATE_FIELDS = new Set([
  "startsAt",
  "endsAt",
  "allDay",
  "technicianIds",
  "notes",
  "sequence",
]);

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

type VisitRow = Prisma.VisitGetPayload<{ select: typeof VISIT_SELECT }>;

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
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.some((item) => typeof item !== "string")) return null;
  return value.map((item) => (item as string).trim()).filter(Boolean);
}

function visitError(
  result: ServiceFailure,
  notFoundMessage = "Fant ikke visitten.",
) {
  switch (result.reason) {
    case "forbidden":
      return apiError(
        403,
        "forbidden",
        "Du har ikke tilgang til visitten.",
        result.details,
      );
    case "not_found":
      return apiError(404, "not_found", notFoundMessage, result.details);
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

/**
 * Visiter på ett oppdrag.
 *
 * Omfanget legges på oppdraget, slik at en visitt aldri kan leses gjennom et
 * oppdrag utenfor brukerens avdeling eller kundeomfang. Listen er paginert og
 * hardt avgrenset av API-ets maksimum på 100 rader.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.view")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til oppdraget.");
  }

  const { id } = await params;
  const scope = workOrderScope(actorForServices(auth.actor));

  const workOrder = await prisma.workOrder.findFirst({
    where: { id, AND: [scope] },
    select: { id: true },
  });
  if (!workOrder) {
    return apiError(404, "not_found", "Fant ikke oppdraget.");
  }

  const url = new URL(request.url);
  const { page, limit, skip } = parseApiPagination(url);
  const where: Prisma.VisitWhereInput = {
    workOrderId: id,
    // Samme omfang som oppslaget over. Det gjør listen trygg også om
    // oppdraget skulle bli flyttet eller slettet mellom de to spørringene.
    workOrder: { AND: [scope] },
  };

  const [total, visits] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { sequence: "asc" }, { id: "asc" }],
      skip,
      take: limit,
      select: VISIT_SELECT,
    }),
  ]);

  return apiJson(
    visits.map((visit) => toVisit(visit)),
    paginationMeta(total, page, limit),
  );
}

/**
 * Oppretter en visitt på oppdraget.
 *
 * Tidsrommet må være ISO 8601 med klokkeslett, og slutten må ligge etter
 * starten. Selve overlapp-, montør- og låst-kontrollen gjøres av
 * tjenestelaget, som også skriver revisjonsloggen.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.edit")) {
    return apiError(
      403,
      "forbidden",
      "Du har ikke tilgang til å opprette visiter.",
    );
  }

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

  const unknownField = Object.keys(body).find(
    (key) => !CREATE_FIELDS.has(key),
  );
  if (unknownField) {
    return apiError(400, "validation_error", "Ukjent felt.", {
      field: unknownField,
    });
  }

  const startsAt = parseDateTime(body.startsAt);
  if (!startsAt) {
    return apiError(
      422,
      "validation_error",
      "Gyldig starttidspunkt (ISO 8601) er påkrevd.",
      { field: "startsAt" },
    );
  }

  const endsAt = parseDateTime(body.endsAt);
  if (!endsAt) {
    return apiError(
      422,
      "validation_error",
      "Gyldig sluttidspunkt (ISO 8601) er påkrevd.",
      { field: "endsAt" },
    );
  }

  if (endsAt.getTime() <= startsAt.getTime()) {
    return apiError(422, "validation_error", "Slutt må være etter start.", {
      field: "endsAt",
      code: "visits.errors.invalidTimeRange",
    });
  }

  if (body.allDay !== undefined && typeof body.allDay !== "boolean") {
    return apiError(422, "validation_error", "allDay må være boolsk.", {
      field: "allDay",
    });
  }

  const technicianIds = readStringList(body.technicianIds);
  if (technicianIds === null) {
    return apiError(
      422,
      "validation_error",
      "technicianIds må være en liste med id-er.",
      { field: "technicianIds" },
    );
  }

  if (
    body.notes !== undefined &&
    body.notes !== null &&
    typeof body.notes !== "string"
  ) {
    return apiError(422, "validation_error", "notes må være tekst.", {
      field: "notes",
    });
  }

  let sequence: number | undefined;
  if (hasOwn(body, "sequence")) {
    if (
      typeof body.sequence !== "number" ||
      !Number.isInteger(body.sequence) ||
      body.sequence < 0
    ) {
      return apiError(422, "validation_error", "sequence må være et heltall.", {
        field: "sequence",
        code: "visits.errors.invalidSequence",
      });
    }
    sequence = body.sequence;
  }

  const { id } = await params;
  const result = await createVisit(auth.actor, {
    workOrderId: id,
    startsAt,
    endsAt,
    allDay: body.allDay === true,
    technicianIds,
    notes:
      body.notes === null
        ? null
        : typeof body.notes === "string"
          ? body.notes
          : undefined,
    sequence,
  });

  if (!result.ok) {
    return visitError(result, "Fant ikke oppdraget.");
  }

  const response = apiJson({ id: result.data.id }, 201);
  response.headers.set("Location", `/api/v1/visits/${result.data.id}`);
  return response;
}
