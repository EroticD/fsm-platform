// i18n-ignore-file: revisjonsteksten er lagrede driftsdata. Siden oversetter
// alle visningsnavn med `bi.*`-nøklene.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { reportStatus } from "@/lib/report-answers";
import {
  addDaysUtc,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import {
  BI_MAX_ORDERS,
  biCsvFileName,
  buildBiCsv,
  normalizeBiFilters,
  summarizeProfitability,
  type BiFilterInput,
  type BiFilters,
  type BiOptions,
  type BiStaff,
  type BiSummary,
} from "@/lib/bi";
import {
  can,
  fail,
  isOfficeActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/**
 * Tjenestelaget for lønnsomhet (BI-01 v1).
 *
 * Bare kontor og administrator får se tallene. Avdelingsomfanget håndheves i
 * selve spørringen – en filterverdi fra URL-en kan aldri utvide omfanget. All
 * summering ligger i `src/lib/bi.ts`, slik at skjerm, CSV og tester bruker
 * nøyaktig samme grunnlag.
 */

const CUSTOMER_OPTION_LIMIT = 300;
const STAFF_OPTION_LIMIT = 500;
const MAX_PRICE_ITEMS = 200;

function emptyOptions(): BiOptions {
  return { departments: [], customers: [], technicians: [] };
}

function decimalValue(value: unknown): number | string {
  if (typeof value === "number" || typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return "0";
}

/**
 * Intern kostnadssats for estimert resultat. Satsen er en driftsinnstilling,
 * ikke en del av datamodellen, og må derfor settes bevisst per installasjon.
 * Uten sats viser rapporten «ikke beregnet» i stedet for å late som
 * dekningsbidraget er lik omsetningen.
 */
export function internalCostRateOrePerHour(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = String(env.BI_INTERNAL_COST_RATE_NOK ?? "").trim();
  if (!raw) return null;
  const nok = Number(raw.replace(",", "."));
  if (!Number.isFinite(nok) || nok < 0) return null;
  return Math.round(nok * 100);
}

function canUseBi(actor: ServiceActor): boolean {
  return actor.isActive && isOfficeActor(actor) && can(actor, "reports.view");
}

export type ProfitabilityData = BiSummary;

export async function getProfitability(
  actor: ServiceActor,
  rawFilters: BiFilterInput = {},
): Promise<ServiceResult<ProfitabilityData>> {
  if (!canUseBi(actor)) return fail("forbidden");

  const normalized = normalizeBiFilters(rawFilters);
  if (!normalized.ok) return fail("invalid");
  const filters = normalized.data;

  // En ansatt kan ikke be om en annen avdeling gjennom filteret. Administrator
  // kan velge fritt, men bare blant aktive avdelinger.
  if (
    filters.departmentId &&
    actor.role !== "ADMIN" &&
    filters.departmentId !== actor.departmentId
  ) {
    return fail("forbidden");
  }

  const departments = await prisma.department.findMany({
    where: {
      isActive: true,
      ...(actor.role === "ADMIN"
        ? filters.departmentId
          ? { id: filters.departmentId }
          : {}
        : { id: actor.departmentId ?? "" }),
    },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true },
  });

  if (filters.departmentId && departments.length === 0) {
    return fail("not_found");
  }

  const departmentIds = departments.map((department) => department.id);
  if (departmentIds.length === 0) {
    return ok(
      summarizeProfitability({
        orders: [],
        staff: [],
        capacityPlans: [],
        businessHours: [],
        filters,
        options: emptyOptions(),
        costRateOrePerHour: internalCostRateOrePerHour(),
      }),
    );
  }

  const fromDate = parseDateOnly(filters.from);
  const toDate = parseDateOnly(filters.to);
  if (!fromDate || !toDate) return fail("invalid");
  const visitFrom = osloDayStart(filters.from);
  const visitTo = osloDayStart(toDateOnly(addDaysUtc(toDate, 1)));

  const workOrderWhere: Prisma.WorkOrderWhereInput = {
    deletedAt: null,
    departmentId: { in: departmentIds },
    scheduledFor: { gte: fromDate, lte: toDate },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.technicianId
      ? { technicians: { some: { id: filters.technicianId } } }
      : {}),
  };

  // Bare feltpersonell teller i utnyttelsen. Rollen TECHNICIAN dekker faste
  // montører; i tillegg tar vi med alle som faktisk er satt på en visitt i
  // perioden, slik at egendefinerte feltroller også kommer med. Kontorroller
  // uten visiter skal ikke senke utnyttelsesgraden.
  const staffWhere: Prisma.UserWhereInput = {
    isActive: true,
    role: { not: "CUSTOMER" },
    departmentId: { in: departmentIds },
    ...(filters.technicianId ? { id: filters.technicianId } : {}),
    OR: [
      { role: "TECHNICIAN" },
      {
        visitAssignments: {
          some: {
            visit: { startsAt: { gte: visitFrom, lt: visitTo } },
          },
        },
      },
      {
        workOrders: {
          some: {
            departmentId: { in: departmentIds },
            deletedAt: null,
            scheduledFor: { gte: fromDate, lte: toDate },
          },
        },
      },
    ],
  };

  const [orders, staffRows, capacityPlans, businessHours, customers] =
    await Promise.all([
      prisma.workOrder.findMany({
        where: workOrderWhere,
        orderBy: [{ scheduledFor: "asc" }, { reference: "asc" }],
        take: BI_MAX_ORDERS + 1,
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          scheduledFor: true,
          departmentId: true,
          department: { select: { name: true } },
          customerId: true,
          customer: { select: { name: true } },
          deviationSourceKey: true,
          technicians: { select: { id: true, name: true } },
          contract: {
            select: {
              priceList: {
                select: {
                  items: {
                    take: MAX_PRICE_ITEMS,
                    orderBy: { code: "asc" },
                    select: { code: true, unit: true, amount: true },
                  },
                },
              },
            },
          },
          reports: {
            where: { deletedAt: null },
            select: { dataJson: true },
          },
          visits: {
            where: {
              startsAt: { gte: visitFrom, lt: visitTo },
              status: { not: "CANCELLED" },
            },
            orderBy: { startsAt: "asc" },
            select: {
              startsAt: true,
              status: true,
              enRouteAt: true,
              onSiteAt: true,
              doneAt: true,
              travelFromEndedAt: true,
              technicians: { select: { userId: true } },
            },
          },
        },
      }),
      prisma.user.findMany({
        where: staffWhere,
        orderBy: { name: "asc" },
        take: STAFF_OPTION_LIMIT,
        select: {
          id: true,
          name: true,
          departmentId: true,
          availability: {
            select: {
              weekday: true,
              startMinute: true,
              endMinute: true,
            },
            take: 100,
          },
        },
      }),
      prisma.capacityPlan.findMany({
        where: {
          departmentId: { in: departmentIds },
          date: { gte: fromDate, lte: toDate },
          ...(filters.technicianId
            ? { technicianId: filters.technicianId }
            : {}),
        },
        select: {
          technicianId: true,
          departmentId: true,
          date: true,
          capacityMinutes: true,
        },
        take: 20_000,
      }),
      prisma.businessHours.findMany({
        where: { departmentId: { in: departmentIds } },
        select: {
          departmentId: true,
          weekday: true,
          openMinute: true,
          closeMinute: true,
        },
        take: 700,
      }),
      prisma.customer.findMany({
        where: {
          deletedAt: null,
          workOrder: {
            some: {
              deletedAt: null,
              departmentId: { in: departmentIds },
            },
          },
        },
        orderBy: { name: "asc" },
        take: CUSTOMER_OPTION_LIMIT,
        select: { id: true, name: true },
      }),
    ]);

  if (orders.length > BI_MAX_ORDERS) return fail("too_large");

  const staff: BiStaff[] = staffRows.map((person) => ({
    id: person.id,
    name: person.name ?? person.id,
    departmentId: person.departmentId,
    availability: person.availability,
  }));

  const orderInputs = orders.map((order) => ({
    id: order.id,
    reference: order.reference,
    title: order.title,
    status: order.status,
    scheduledFor: order.scheduledFor,
    departmentId: order.departmentId,
    departmentName: order.department.name,
    customerId: order.customerId,
    customerName: order.customer?.name ?? null,
    technicians: order.technicians.map((technician) => ({
      id: technician.id,
      name: technician.name ?? technician.id,
    })),
    visits: order.visits.map((visit) => ({
      startsAt: visit.startsAt,
      status: visit.status,
      enRouteAt: visit.enRouteAt,
      onSiteAt: visit.onSiteAt,
      doneAt: visit.doneAt,
      travelFromEndedAt: visit.travelFromEndedAt,
      technicianIds: visit.technicians.map(
        (technician) => technician.userId,
      ),
    })),
    reportStatuses: order.reports.map((report) =>
      reportStatus(report.dataJson),
    ),
    deviationRemediation: Boolean(order.deviationSourceKey),
    priceItems: order.contract?.priceList?.items.map((item) => ({
      code: item.code,
      unit: item.unit,
      amount: decimalValue(item.amount),
    })) ?? null,
  }));

  const options: BiOptions = {
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
    })),
    customers,
    technicians: staffRows.map((person) => ({
      id: person.id,
      name: person.name ?? person.id,
    })),
  };

  const data = summarizeProfitability({
    orders: orderInputs,
    staff,
    capacityPlans: capacityPlans.map((plan) => ({
      technicianId: plan.technicianId,
      departmentId: plan.departmentId,
      date: plan.date,
      capacityMinutes: plan.capacityMinutes,
    })),
    businessHours,
    filters,
    options,
    costRateOrePerHour: internalCostRateOrePerHour(),
  });

  return ok(data);
}

export type BiExportData = {
  csv: string;
  fileName: string;
  checksum: string;
  rowCount: number;
  filters: BiFilters;
};

/**
 * Eksporterer nøyaktig det samme datasettet som skjermen viser. Innholdet er
 * deterministisk for et gitt filter (stabil sortering, ingen tidsstempel i
 * filen), så gjentatte eksporter gir samme fil og samme sjekksum. Hver eksport
 * revideres likevel som en egen hendelse – revisjonsloggen er hendelsesbasert.
 */
export async function exportProfitabilityCsv(
  actor: ServiceActor,
  rawFilters: BiFilterInput = {},
): Promise<ServiceResult<BiExportData>> {
  const result = await getProfitability(actor, rawFilters);
  if (!result.ok) return result;

  const csv = buildBiCsv(result.data);
  const checksum = createHash("sha256").update(csv, "utf8").digest("hex");
  const fileName = biCsvFileName(result.data.filters);
  const rowCount =
    1 + result.data.perTechnician.length + result.data.perCustomer.length +
    result.data.perOrder.length;

  await prisma.$transaction(async (tx) => {
    await audit(tx, {
      entityType: "ProfitabilityExport",
      entityId: checksum,
      action: `Eksporterte lønnsomhetsrapport for ${result.data.filters.from}–${result.data.filters.to}`,
      actor: toAuditActor(actor),
      departmentId:
        result.data.filters.departmentId ?? actor.departmentId ?? null,
      metadata: {
        from: result.data.filters.from,
        to: result.data.filters.to,
        departmentId: result.data.filters.departmentId,
        customerId: result.data.filters.customerId,
        technicianId: result.data.filters.technicianId,
        rowCount,
        checksum,
        estimatedRevenue: true,
        actualRevenueAvailable: false,
      },
    });
  });

  return ok({
    csv,
    fileName,
    checksum,
    rowCount,
    filters: result.data.filters,
  });
}
