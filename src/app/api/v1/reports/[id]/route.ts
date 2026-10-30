import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { parseJsonObject } from "@/lib/report-answers";
import { reportWorkOrderScope } from "@/lib/report-scope";

export const runtime = "nodejs";

const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 20;
const MAX_ARRAY_ITEMS = 1000;

/**
 * Gjør et vilkårlig JSON-tre trygt å serialisere tilbake til en klient.
 *
 * Rapporten er et frosset dokument, men dataJson kan inneholde nøkler fra
 * eldre skjemaversjoner. Vi fjerner prototype-nøkler og begrenser dybde og
 * listelengde, slik at et ødelagt eller ondsinnet svar ikke kan bli en
 * prototype-forurensning eller en urimelig stor respons.
 */
function safeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => safeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      result[key] = safeValue(item, depth + 1);
    }
    return result;
  }
  return null;
}

function safeRecord(value: unknown): Record<string, unknown> {
  const safe = safeValue(value);
  return safe && typeof safe === "object" && !Array.isArray(safe)
    ? (safe as Record<string, unknown>)
    : {};
}

/** Bare signaturfiler i appens egen opplastingsmappe får en URL i svaret. */
function safeSignatureUrl(value: string | null): string | null {
  return value && UPLOAD_URL.test(value) ? value : null;
}

/**
 * Én rapport med svarene frosset slik de ble signert.
 *
 * Rapporten slås opp gjennom rapportomfanget, ikke bare oppdragsomfanget.
 * En rapport utenfor egen avdeling gir derfor 404, som om den ikke finnes.
 * Malens id, felter og rådata eksponeres ikke – bare tittelen som ble lagret
 * på rapporten da den ble signert.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "reports.view")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til rapporter.");
  }

  const { id } = await params;
  const report = await prisma.report.findFirst({
    where: {
      id,
      deletedAt: null,
      workOrder: {
        AND: [reportWorkOrderScope(auth.actor), { deletedAt: null }],
      },
    },
    select: {
      id: true,
      name: true,
      reportNumber: true,
      templateTitle: true,
      templateCategory: true,
      hmsType: true,
      requiresUnits: true,
      comments: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      isLocked: true,
      lockedAt: true,
      lockedByName: true,
      revision: true,
      legalHold: true,
      technicianSignatureUrl: true,
      customerSignatureUrl: true,
      technicianName: true,
      customerName: true,
      customerAcknowledgedAt: true,
      customerAcknowledgedBy: true,
      customerAcknowledgedComment: true,
      dataJson: true,
      workOrder: {
        select: {
          id: true,
          title: true,
          orderNumber: true,
          status: true,
          customerId: true,
          departmentId: true,
          customer: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      },
      units: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          label: true,
          serialNumber: true,
          location: true,
          status: true,
          comment: true,
          answersJson: true,
        },
      },
    },
  });

  if (!report) {
    return apiError(404, "not_found", "Fant ikke rapporten.");
  }

  const parsed = safeRecord(parseJsonObject(report.dataJson));
  const answers = safeRecord(parsed.answers);
  const units = report.units.map(({ answersJson, ...unit }) => ({
    ...unit,
    answers: safeRecord(parseJsonObject(answersJson)),
  }));

  const technicianUrl = safeSignatureUrl(report.technicianSignatureUrl);
  const customerUrl = safeSignatureUrl(report.customerSignatureUrl);

  return apiJson({
    id: report.id,
    name: report.name,
    reportNumber: report.reportNumber,
    templateTitle: report.templateTitle,
    templateCategory: report.templateCategory,
    hmsType: report.hmsType,
    requiresUnits: report.requiresUnits,
    status: typeof parsed.status === "string" ? parsed.status : null,
    answers,
    units,
    comments: report.comments,
    completedAt: report.completedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    isLocked: report.isLocked,
    lockedAt: report.lockedAt,
    lockedByName: report.lockedByName,
    revision: report.revision,
    legalHold: report.legalHold,
    workOrder: report.workOrder,
    signatures: {
      technician: {
        signed: Boolean(report.technicianSignatureUrl),
        name: report.technicianName,
        url: technicianUrl,
      },
      customer: {
        signed: Boolean(report.customerSignatureUrl),
        name: report.customerName,
        url: customerUrl,
      },
    },
    customerAcknowledgedAt: report.customerAcknowledgedAt,
    customerAcknowledgedBy: report.customerAcknowledgedBy,
    customerAcknowledgedComment: report.customerAcknowledgedComment,
  });
}
