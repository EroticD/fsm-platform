// i18n-ignore-file: CSV-kolonner og revisjonstekster er filformat/data, ikke
// UI-tekst. Siden oversetter visningsnavnene med `bi.*`-nøklene.
/**
 * Ren lønnsomhetslogikk for BI-01.
 *
 * Modulen er bevisst uten databaseavhengigheter: serverlaget henter avgrensede
 * rader, og all summering, first-time-fix-utledning, kapasitetsberegning og
 * CSV-formatering skjer her. Da kan tallene testes uten en nettleser eller en
 * database, og eksporten bruker nøyaktig samme tallgrunnlag som dashbordet.
 *
 * Viktig avgrensning i v1: systemet har ingen fakturaer (REV-02). Inntekt er
 * derfor alltid et estimat basert på timepris i avtalens prisliste. Feltet
 * `actualRevenueOre` er `null` og `actualAvailable` er `false` til
 * faktureringsmodulen finnes.
 */

import {
  summarizeVisitTimes,
  type TimeTotals,
  type VisitTimeFields,
} from "@/lib/visit-time";
import { toCsv } from "@/lib/csv";
import {
  addDaysUtc,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";

export const BI_MAX_PERIOD_DAYS = 366;
export const BI_MAX_ORDERS = 5_000;

export type BiFilterInput = {
  from?: string | string[];
  to?: string | string[];
  departmentId?: string | string[];
  customerId?: string | string[];
  technicianId?: string | string[];
};

export type BiFilters = {
  from: string;
  to: string;
  departmentId: string | null;
  customerId: string | null;
  technicianId: string | null;
  departmentName?: string | null;
  customerName?: string | null;
  technicianName?: string | null;
};

export type BiOption = { id: string; name: string };

export type BiOptions = {
  departments: BiOption[];
  customers: BiOption[];
  technicians: BiOption[];
};

export type BiPriceItem = {
  code: string;
  unit: string;
  amount: number | string;
};

export type BiVisit = VisitTimeFields & {
  startsAt: Date;
  status?: string | null;
  technicianIds: string[];
};

export type BiOrder = {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduledFor: Date | null;
  departmentId: string;
  departmentName: string;
  customerId: string | null;
  customerName: string | null;
  technicians: Array<{ id: string; name: string }>;
  visits: BiVisit[];
  reportStatuses: string[];
  /** Oppdraget er automatisk opprettet for å rette avvik i en rapport. */
  deviationRemediation: boolean;
  /** Timeprisrader fra avtalens prisliste, hvis oppdraget har en avtale. */
  priceItems: BiPriceItem[] | null;
};

export type BiStaff = {
  id: string;
  name: string;
  departmentId: string | null;
  availability: Array<{
    weekday: number;
    startMinute: number;
    endMinute: number;
  }>;
};

export type BiCapacityPlan = {
  technicianId: string | null;
  departmentId: string;
  date: Date;
  capacityMinutes: number;
};

export type BiBusinessHours = {
  departmentId: string;
  weekday: number;
  openMinute: number;
  closeMinute: number;
};

export type BiSummaryInput = {
  orders: BiOrder[];
  staff: BiStaff[];
  capacityPlans: BiCapacityPlan[];
  businessHours: BiBusinessHours[];
  filters: BiFilters;
  options: BiOptions;
  /** Intern kostnadssats i øre per time. `null` gir ingen resultatberegning. */
  costRateOrePerHour?: number | null;
};

export type BiFirstTimeFixOutcome =
  | "fixed"
  | "not_fixed"
  | "not_measurable";

export type BiOrderRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduledFor: string;
  departmentId: string;
  departmentName: string;
  customerId: string | null;
  customerName: string;
  technicians: string;
  workMinutes: number;
  travelMinutes: number;
  totalMinutes: number;
  firstTimeFix: BiFirstTimeFixOutcome;
  estimatedRevenueOre: number | null;
  hourlyRateOre: number | null;
  actualRevenueOre: null;
  deviationRemediation: boolean;
};

export type BiTechnicianRow = {
  id: string;
  name: string;
  orders: number;
  completed: number;
  workMinutes: number;
  travelMinutes: number;
  totalMinutes: number;
  availableMinutes: number;
  utilizationPercent: number | null;
  workUtilizationPercent: number | null;
  firstTimeFixEligible: number;
  firstTimeFixFixed: number;
  firstTimeFixRate: number | null;
  estimatedRevenueOre: number;
  estimatedRevenueOrders: number;
};

export type BiCustomerRow = {
  id: string | null;
  name: string;
  orders: number;
  completed: number;
  workMinutes: number;
  travelMinutes: number;
  totalMinutes: number;
  firstTimeFixEligible: number;
  firstTimeFixFixed: number;
  firstTimeFixRate: number | null;
  estimatedRevenueOre: number;
  estimatedRevenueOrders: number;
};

export type BiSummary = {
  filters: BiFilters;
  options: BiOptions;
  orders: {
    total: number;
    completed: number;
    cancelled: number;
    open: number;
    completionRate: number | null;
    byStatus: Record<string, number>;
  };
  firstTimeFix: {
    eligible: number;
    fixed: number;
    rate: number | null;
    deviations: number;
    remediationOrders: number;
  };
  time: TimeTotals;
  capacity: {
    availableMinutes: number;
    basis:
      | "capacity_plan"
      | "availability"
      | "business_hours"
      | "default_8h"
      | "mixed"
      | "none";
    utilizationPercent: number | null;
    workUtilizationPercent: number | null;
  };
  revenue: {
    /** Faktisk omsetning finnes ikke før REV-02. */
    actualAvailable: false;
    actualRevenueOre: null;
    estimatedRevenueOre: number;
    estimatedRevenueOrders: number;
    ordersWithoutRate: number;
    coveragePercent: number | null;
    basis: "contract_price_list" | "partial" | "missing";
    estimatedCostOre: number | null;
    estimatedProfitOre: number | null;
    costBasis: "internal_rate" | "missing";
    costRateOrePerHour: number | null;
  };
  perTechnician: BiTechnicianRow[];
  perCustomer: BiCustomerRow[];
  perOrder: BiOrderRow[];
};

/** Normaliserer en enkelt søkeparameter. */
export function firstParam(
  value: string | string[] | undefined,
): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

/**
 * Leser og validerer filterparametrene. Standardperiode er inneværende måned
 * til og med i dag, regnet i Europe/Oslo. Perioden er begrenset slik at en
 * direkte URL ikke kan be om hele historikken i én spørring.
 */
export function normalizeBiFilters(
  input: BiFilterInput,
  now = new Date(),
):
  | { ok: true; data: BiFilters }
  | { ok: false; reason: "invalid" } {
  const today = todayInOslo(now);
  const defaultFrom = `${today.slice(0, 7)}-01`;
  const rawFrom = firstParam(input.from) || defaultFrom;
  const rawTo = firstParam(input.to) || today;

  const fromDate = parseDateOnly(rawFrom);
  const toDate = parseDateOnly(rawTo);
  if (!fromDate || !toDate) return { ok: false, reason: "invalid" };
  if (toDate < fromDate) return { ok: false, reason: "invalid" };
  const days = Math.round(
    (toDate.getTime() - fromDate.getTime()) / 86_400_000,
  );
  if (days > BI_MAX_PERIOD_DAYS) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    data: {
      from: toDateOnly(fromDate),
      to: toDateOnly(toDate),
      departmentId: firstParam(input.departmentId) || null,
      customerId: firstParam(input.customerId) || null,
      technicianId: firstParam(input.technicianId) || null,
    },
  };
}

const HOURLY_UNITS = new Set([
  "time",
  "timer",
  "h",
  "hour",
  "hours",
  "timeverk",
  "arbeidstime",
  "arbeidstimer",
]);

const HOURLY_CODES = new Set([
  "TIME",
  "TIMER",
  "ARBEIDSTIME",
  "ARBEIDSTIMER",
  "TIMEVERK",
  "HOURLY",
  "HOUR",
]);

function normalizedCode(value: string): string {
  return value.toUpperCase().replace(/[^A-ZÆØÅ0-9]/g, "");
}

function isHourlyItem(item: BiPriceItem): boolean {
  return (
    HOURLY_UNITS.has(item.unit.trim().toLowerCase()) ||
    HOURLY_CODES.has(normalizedCode(item.code))
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function amountAsNumber(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Finner timeprisen i en prisliste. Bare rader som uttrykkelig er per time
 * godtas; en vilkårlig fastpris ville gitt et misvisende inntektsestimat.
 * Ved flere treff velges den første i stabil rekkefølge, slik at eksporten er
 * reproduserbar.
 */
export function hourlyRateOreForItems(
  items: BiPriceItem[] | null | undefined,
): number | null {
  if (!items || items.length === 0) return null;
  const hourly = items
    .filter(isHourlyItem)
    .map((item) => ({ item, amount: amountAsNumber(item.amount) }))
    .filter(
      (entry): entry is { item: BiPriceItem; amount: number } =>
        entry.amount !== null,
    )
    .sort((a, b) => {
      const code = compareText(
        normalizedCode(a.item.code),
        normalizedCode(b.item.code),
      );
      if (code !== 0) return code;
      return a.amount - b.amount;
    });
  if (hourly.length === 0) return null;
  return Math.round(hourly[0].amount * 100);
}

/**
 * First-time-fix måles bare på fullførte oppdrag som har en signert rapport og
 * som ikke selv er et utbedringsoppdrag. Et avvik i en rapport gir «ikke fikset
 * første gang»; uten rapport er oppdraget ikke målbart og holdes utenfor
 * nevneren. Det gjør at manglende rapportering ikke kunstig blåser opp raten.
 */
export function firstTimeFixOutcome(
  order: Pick<
    BiOrder,
    "status" | "reportStatuses" | "deviationRemediation"
  >,
): BiFirstTimeFixOutcome {
  if (order.status !== "COMPLETED") return "not_measurable";
  if (order.deviationRemediation) return "not_measurable";
  if (order.reportStatuses.length === 0) return "not_measurable";
  return order.reportStatuses.some((status) => status === "AVVIK")
    ? "not_fixed"
    : "fixed";
}

function percent(part: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.round((part / total) * 1000) / 10;
}

function dateKey(date: Date): string {
  return toDateOnly(date);
}

function weekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

function eachDate(from: string, to: string): Date[] {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end || end < start) return [];
  const dates: Date[] = [];
  for (
    let current = start;
    current <= end && dates.length <= BI_MAX_PERIOD_DAYS;
    current = addDaysUtc(current, 1)
  ) {
    dates.push(current);
  }
  return dates;
}

export type BiCapacityResult = {
  availableMinutes: number;
  byTechnician: Record<string, number>;
  basis: BiSummary["capacity"]["basis"];
};

/**
 * Tilgjengelige minutter per montør i perioden. Rekkefølgen er den samme som
 * kapasitetssiden: eksplisitt dagsplan vinner, deretter montørens arbeidstid,
 * deretter avdelingens åpningstider, og til slutt en nøytral 8-timersdag.
 * Fravær trekkes ikke fra i v1; det er dokumentert i docs/BI.md.
 */
export function computeCapacityMinutes(
  staff: BiStaff[],
  plans: BiCapacityPlan[],
  businessHours: BiBusinessHours[],
  from: string,
  to: string,
): BiCapacityResult {
  const dates = eachDate(from, to);
  const byTechnician: Record<string, number> = {};
  if (staff.length === 0 || dates.length === 0) {
    return { availableMinutes: 0, byTechnician, basis: "none" };
  }

  const availability = new Map<string, number>();
  for (const person of staff) {
    for (const window of person.availability) {
      if (window.endMinute > window.startMinute) {
        const key = `${person.id}:${window.weekday}`;
        availability.set(
          key,
          (availability.get(key) ?? 0) + window.endMinute - window.startMinute,
        );
      }
    }
  }

  const explicit = new Map<string, number>();
  for (const plan of plans) {
    if (!plan.technicianId) continue;
    explicit.set(
      `${plan.technicianId}:${dateKey(plan.date)}`,
      Math.max(0, plan.capacityMinutes),
    );
  }

  const business = new Map<string, number>();
  for (const row of businessHours) {
    if (row.closeMinute > row.openMinute) {
      const key = `${row.departmentId}:${row.weekday}`;
      business.set(
        key,
        (business.get(key) ?? 0) + row.closeMinute - row.openMinute,
      );
    }
  }

  let explicitCount = 0;
  let availabilityCount = 0;
  let businessCount = 0;
  let defaultCount = 0;

  for (const person of staff) {
    let total = 0;
    for (const date of dates) {
      const weekday = weekdayIndex(date);
      const explicitKey = `${person.id}:${dateKey(date)}`;
      const plan = explicit.get(explicitKey);
      if (plan !== undefined) {
        total += plan;
        explicitCount += 1;
        continue;
      }

      const available = availability.get(`${person.id}:${weekday}`);
      if (available !== undefined) {
        total += available;
        availabilityCount += 1;
        continue;
      }

      const open = person.departmentId
        ? business.get(`${person.departmentId}:${weekday}`)
        : undefined;
      if (open !== undefined) {
        total += open;
        businessCount += 1;
      } else {
        total += 8 * 60;
        defaultCount += 1;
      }
    }
    byTechnician[person.id] = total;
  }

  let basis: BiSummary["capacity"]["basis"];
  if (explicitCount > 0 && defaultCount + availabilityCount + businessCount > 0) {
    basis = "mixed";
  } else if (
    explicitCount > 0 &&
    defaultCount + availabilityCount + businessCount === 0
  ) {
    basis = "capacity_plan";
  } else if (availabilityCount > 0 && businessCount > 0) {
    basis = "mixed";
  } else if (availabilityCount > 0) {
    basis = "availability";
  } else if (businessCount > 0) {
    basis = "business_hours";
  } else {
    basis = "default_8h";
  }

  return {
    availableMinutes: Object.values(byTechnician).reduce(
      (sum, minutes) => sum + minutes,
      0,
    ),
    byTechnician,
    basis,
  };
}

function sumTotals(totals: TimeTotals[]): TimeTotals {
  return totals.reduce(
    (sum, item) => ({
      travelToMinutes: sum.travelToMinutes + item.travelToMinutes,
      workMinutes: sum.workMinutes + item.workMinutes,
      travelFromMinutes: sum.travelFromMinutes + item.travelFromMinutes,
      totalMinutes: sum.totalMinutes + item.totalMinutes,
      travelMinutes: sum.travelMinutes + item.travelMinutes,
      sessions: sum.sessions + item.sessions,
      completedSessions: sum.completedSessions + item.completedSessions,
      ongoingSessions: sum.ongoingSessions + item.ongoingSessions,
    }),
    {
      travelToMinutes: 0,
      workMinutes: 0,
      travelFromMinutes: 0,
      totalMinutes: 0,
      travelMinutes: 0,
      sessions: 0,
      completedSessions: 0,
      ongoingSessions: 0,
    },
  );
}

function emptyTimeTotals(): TimeTotals {
  return {
    travelToMinutes: 0,
    workMinutes: 0,
    travelFromMinutes: 0,
    totalMinutes: 0,
    travelMinutes: 0,
    sessions: 0,
    completedSessions: 0,
    ongoingSessions: 0,
  };
}

function technicianIdsForOrder(order: BiOrder): string[] {
  const ids = new Set<string>();
  for (const technician of order.technicians) ids.add(technician.id);
  for (const visit of order.visits) {
    for (const technicianId of visit.technicianIds) ids.add(technicianId);
  }
  return [...ids];
}

/** Summerer arbeid/reise per montør. Delt visitt telles for hver deltaker. */
function timeByTechnician(order: BiOrder): Map<string, TimeTotals> {
  const result = new Map<string, TimeTotals>();
  const fallback = order.technicians.map((technician) => technician.id);
  for (const visit of order.visits) {
    const ids = visit.technicianIds.length > 0 ? visit.technicianIds : fallback;
    if (ids.length === 0) continue;
    const totals = summarizeVisitTimes([visit]);
    for (const id of ids) {
      result.set(id, sumTotals([result.get(id) ?? emptyTimeTotals(), totals]));
    }
  }
  return result;
}

/**
 * Bygger hele lønnsomhetsrapporten. Alle beløp er i øre. Inntekt per oppdrag
 * er arbeidstid × timepris fra avtalens prisliste; reisetid inngår i
 * timegrunnlaget for utnyttelse, men ikke i inntektsestimatet.
 */
export function summarizeProfitability(input: BiSummaryInput): BiSummary {
  const costRateOrePerHour =
    typeof input.costRateOrePerHour === "number" &&
    Number.isFinite(input.costRateOrePerHour) &&
    input.costRateOrePerHour >= 0
      ? Math.round(input.costRateOrePerHour)
      : null;

  const orderViews = input.orders.map((order) => {
    const time = summarizeVisitTimes(order.visits);
    const hourlyRateOre = hourlyRateOreForItems(order.priceItems);
    const estimatedRevenueOre =
      hourlyRateOre === null
        ? null
        : Math.round((time.workMinutes / 60) * hourlyRateOre);
    return {
      order,
      time,
      hourlyRateOre,
      estimatedRevenueOre,
      firstTimeFix: firstTimeFixOutcome(order),
    };
  });

  const byStatus: Record<string, number> = {};
  for (const view of orderViews) {
    byStatus[view.order.status] = (byStatus[view.order.status] ?? 0) + 1;
  }

  const completed = orderViews.filter(
    (view) => view.order.status === "COMPLETED",
  ).length;
  const cancelled = orderViews.filter(
    (view) => view.order.status === "CANCELLED",
  ).length;
  const total = orderViews.length;
  const open = total - completed - cancelled;

  const ftfEligible = orderViews.filter(
    (view) => view.firstTimeFix !== "not_measurable",
  );
  const ftfFixed = ftfEligible.filter(
    (view) => view.firstTimeFix === "fixed",
  ).length;
  const deviations = orderViews.filter((view) =>
    view.order.reportStatuses.some((status) => status === "AVVIK"),
  ).length;
  const remediationOrders = orderViews.filter(
    (view) => view.order.deviationRemediation,
  ).length;

  const overallTime = summarizeVisitTimes(
    orderViews.flatMap((view) => view.order.visits),
  );
  const capacity = computeCapacityMinutes(
    input.staff,
    input.capacityPlans,
    input.businessHours,
    input.filters.from,
    input.filters.to,
  );

  const revenueOrders = orderViews.filter(
    (view) => view.estimatedRevenueOre !== null,
  );
  const estimatedRevenueOre = revenueOrders.reduce(
    (sum, view) => sum + (view.estimatedRevenueOre ?? 0),
    0,
  );
  const ordersWithoutRate = total - revenueOrders.length;
  const estimatedCostOre =
    costRateOrePerHour === null
      ? null
      : Math.round((overallTime.totalMinutes / 60) * costRateOrePerHour);
  const estimatedProfitOre =
    costRateOrePerHour === null ||
    revenueOrders.length === 0 ||
    ordersWithoutRate > 0
      ? null
      : estimatedRevenueOre - (estimatedCostOre ?? 0);

  const staffById = new Map(input.staff.map((person) => [person.id, person]));
  const technicianName = (id: string): string =>
    staffById.get(id)?.name ?? id;

  const technicianAgg = new Map<
    string,
    {
      id: string;
      name: string;
      orders: number;
      completed: number;
      time: TimeTotals;
      firstTimeFixEligible: number;
      firstTimeFixFixed: number;
      estimatedRevenueOre: number;
      estimatedRevenueOrders: number;
    }
  >();

  for (const view of orderViews) {
    const ids = technicianIdsForOrder(view.order);
    const perTechnicianTime = timeByTechnician(view.order);
    for (const id of ids) {
      const existing =
        technicianAgg.get(id) ?? {
          id,
          name: technicianName(id),
          orders: 0,
          completed: 0,
          time: emptyTimeTotals(),
          firstTimeFixEligible: 0,
          firstTimeFixFixed: 0,
          estimatedRevenueOre: 0,
          estimatedRevenueOrders: 0,
        };
      existing.orders += 1;
      if (view.order.status === "COMPLETED") existing.completed += 1;
      existing.time = sumTotals([
        existing.time,
        perTechnicianTime.get(id) ?? emptyTimeTotals(),
      ]);
      if (view.firstTimeFix !== "not_measurable") {
        existing.firstTimeFixEligible += 1;
        if (view.firstTimeFix === "fixed") existing.firstTimeFixFixed += 1;
      }
      if (view.estimatedRevenueOre !== null) {
        existing.estimatedRevenueOre += view.estimatedRevenueOre;
        existing.estimatedRevenueOrders += 1;
      }
      technicianAgg.set(id, existing);
    }
  }

  const perTechnician: BiTechnicianRow[] = [...technicianAgg.values()]
    .map((row) => {
      const availableMinutes = capacity.byTechnician[row.id] ?? 0;
      return {
        id: row.id,
        name: row.name,
        orders: row.orders,
        completed: row.completed,
        workMinutes: row.time.workMinutes,
        travelMinutes: row.time.travelMinutes,
        totalMinutes: row.time.totalMinutes,
        availableMinutes,
        utilizationPercent: percent(row.time.totalMinutes, availableMinutes),
        workUtilizationPercent: percent(row.time.workMinutes, availableMinutes),
        firstTimeFixEligible: row.firstTimeFixEligible,
        firstTimeFixFixed: row.firstTimeFixFixed,
        firstTimeFixRate: percent(
          row.firstTimeFixFixed,
          row.firstTimeFixEligible,
        ),
        estimatedRevenueOre: row.estimatedRevenueOre,
        estimatedRevenueOrders: row.estimatedRevenueOrders,
      };
    })
    .sort(
      (a, b) =>
        b.totalMinutes - a.totalMinutes ||
        compareText(a.name, b.name) ||
        compareText(a.id, b.id),
    );

  const customerAgg = new Map<
    string,
    {
      id: string | null;
      name: string;
      orders: number;
      completed: number;
      time: TimeTotals;
      firstTimeFixEligible: number;
      firstTimeFixFixed: number;
      estimatedRevenueOre: number;
      estimatedRevenueOrders: number;
    }
  >();

  for (const view of orderViews) {
    const key = view.order.customerId ?? "__none__";
    const existing =
      customerAgg.get(key) ?? {
        id: view.order.customerId,
        name: view.order.customerName ?? "Uten kunde",
        orders: 0,
        completed: 0,
        time: emptyTimeTotals(),
        firstTimeFixEligible: 0,
        firstTimeFixFixed: 0,
        estimatedRevenueOre: 0,
        estimatedRevenueOrders: 0,
      };
    existing.orders += 1;
    if (view.order.status === "COMPLETED") existing.completed += 1;
    existing.time = sumTotals([existing.time, view.time]);
    if (view.firstTimeFix !== "not_measurable") {
      existing.firstTimeFixEligible += 1;
      if (view.firstTimeFix === "fixed") existing.firstTimeFixFixed += 1;
    }
    if (view.estimatedRevenueOre !== null) {
      existing.estimatedRevenueOre += view.estimatedRevenueOre;
      existing.estimatedRevenueOrders += 1;
    }
    customerAgg.set(key, existing);
  }

  const perCustomer: BiCustomerRow[] = [...customerAgg.values()]
    .map((row) => ({
      id: row.id,
      name: row.name,
      orders: row.orders,
      completed: row.completed,
      workMinutes: row.time.workMinutes,
      travelMinutes: row.time.travelMinutes,
      totalMinutes: row.time.totalMinutes,
      firstTimeFixEligible: row.firstTimeFixEligible,
      firstTimeFixFixed: row.firstTimeFixFixed,
      firstTimeFixRate: percent(
        row.firstTimeFixFixed,
        row.firstTimeFixEligible,
      ),
      estimatedRevenueOre: row.estimatedRevenueOre,
      estimatedRevenueOrders: row.estimatedRevenueOrders,
    }))
    .sort(
      (a, b) =>
        b.totalMinutes - a.totalMinutes ||
        compareText(a.name, b.name),
    );

  const perOrder: BiOrderRow[] = orderViews
    .map((view) => ({
      id: view.order.id,
      reference: view.order.reference,
      title: view.order.title,
      status: view.order.status,
      scheduledFor: view.order.scheduledFor
        ? toDateOnly(view.order.scheduledFor)
        : "",
      departmentId: view.order.departmentId,
      departmentName: view.order.departmentName,
      customerId: view.order.customerId,
      customerName: view.order.customerName ?? "Uten kunde",
      technicians: view.order.technicians
        .map((technician) => technician.name)
        .join(", "),
      workMinutes: view.time.workMinutes,
      travelMinutes: view.time.travelMinutes,
      totalMinutes: view.time.totalMinutes,
      firstTimeFix: view.firstTimeFix,
      estimatedRevenueOre: view.estimatedRevenueOre,
      hourlyRateOre: view.hourlyRateOre,
      actualRevenueOre: null,
      deviationRemediation: view.order.deviationRemediation,
    }))
    .sort(
      (a, b) =>
        compareText(a.scheduledFor, b.scheduledFor) ||
        compareText(a.reference, b.reference),
    );

  const findName = (options: BiOption[], id: string | null) =>
    id ? options.find((option) => option.id === id)?.name ?? null : null;

  const revenueBasis: BiSummary["revenue"]["basis"] =
    revenueOrders.length === 0
      ? "missing"
      : ordersWithoutRate > 0
        ? "partial"
        : "contract_price_list";

  return {
    filters: {
      ...input.filters,
      departmentName: findName(input.options.departments, input.filters.departmentId),
      customerName: findName(input.options.customers, input.filters.customerId),
      technicianName: findName(input.options.technicians, input.filters.technicianId),
    },
    options: input.options,
    orders: {
      total,
      completed,
      cancelled,
      open,
      completionRate: percent(completed, total),
      byStatus,
    },
    firstTimeFix: {
      eligible: ftfEligible.length,
      fixed: ftfFixed,
      rate: percent(ftfFixed, ftfEligible.length),
      deviations,
      remediationOrders,
    },
    time: overallTime,
    capacity: {
      availableMinutes: capacity.availableMinutes,
      basis: capacity.basis,
      utilizationPercent: percent(
        overallTime.totalMinutes,
        capacity.availableMinutes,
      ),
      workUtilizationPercent: percent(
        overallTime.workMinutes,
        capacity.availableMinutes,
      ),
    },
    revenue: {
      actualAvailable: false,
      actualRevenueOre: null,
      estimatedRevenueOre,
      estimatedRevenueOrders: revenueOrders.length,
      ordersWithoutRate,
      coveragePercent: percent(revenueOrders.length, total),
      basis: revenueBasis,
      estimatedCostOre,
      estimatedProfitOre,
      costBasis: costRateOrePerHour === null ? "missing" : "internal_rate",
      costRateOrePerHour,
    },
    perTechnician,
    perCustomer,
    perOrder,
  };
}

function csvMoney(ore: number | null): string {
  return ore === null ? "" : (ore / 100).toFixed(2);
}

function csvPercent(value: number | null): string {
  return value === null ? "" : value.toFixed(1);
}

function csvHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/**
 * Én flat CSV med nivåene sammendrag, tekniker, kunde og oppdrag. Samme
 * dataobjekt som dashbordet bruker, slik at eksporten alltid følger filtrene
 * og avdelingsomfanget. `toCsv` legger på BOM og nøytraliserer formelinjeksjon.
 */
export function buildBiCsv(data: BiSummary): string {
  const header = [
    "Nivå",
    "Nøkkel",
    "Navn",
    "Avdeling",
    "Kunde",
    "Status",
    "Dato",
    "Teknikere",
    "Oppdrag",
    "Fullført",
    "First-time-fix %",
    "Arbeidstimer",
    "Reisetimer",
    "Totaltimer",
    "Tilgjengelighetstimer",
    "Utnyttelse %",
    "Estimert inntekt (NOK)",
    "Faktisk inntekt (NOK)",
    "Inntektsgrunnlag",
    "Estimert kostnad (NOK)",
    "Estimert resultat (NOK)",
    "Fra",
    "Til",
    "Avdelingsfilter",
    "Kundefilter",
    "Teknikerfilter",
    "Kostnadsgrunnlag",
  ];

  const meta = [
    data.filters.from,
    data.filters.to,
    data.filters.departmentName ?? data.filters.departmentId ?? "",
    data.filters.customerName ?? data.filters.customerId ?? "",
    data.filters.technicianName ?? data.filters.technicianId ?? "",
    data.revenue.costBasis === "internal_rate"
      ? `Intern sats ${csvMoney(data.revenue.costRateOrePerHour)} kr/t`
      : "Mangler kostnadssats",
  ];

  const rows: unknown[][] = [
    [
      "Sammendrag",
      "alle",
      "Lønnsomhet",
      data.filters.departmentName ?? "",
      data.filters.customerName ?? "",
      "",
      `${data.filters.from} - ${data.filters.to}`,
      "",
      data.orders.total,
      data.orders.completed,
      csvPercent(data.firstTimeFix.rate),
      csvHours(data.time.workMinutes),
      csvHours(data.time.travelMinutes),
      csvHours(data.time.totalMinutes),
      csvHours(data.capacity.availableMinutes),
      csvPercent(data.capacity.utilizationPercent),
      csvMoney(data.revenue.estimatedRevenueOre),
      "",
      data.revenue.basis,
      csvMoney(data.revenue.estimatedCostOre),
      csvMoney(data.revenue.estimatedProfitOre),
      ...meta,
    ],
    ...data.perTechnician.map((row) => [
      "Tekniker",
      row.id,
      row.name,
      "",
      "",
      "",
      "",
      row.name,
      row.orders,
      row.completed,
      csvPercent(row.firstTimeFixRate),
      csvHours(row.workMinutes),
      csvHours(row.travelMinutes),
      csvHours(row.totalMinutes),
      csvHours(row.availableMinutes),
      csvPercent(row.utilizationPercent),
      csvMoney(row.estimatedRevenueOre),
      "",
      row.estimatedRevenueOrders > 0 ? "contract_price_list" : "missing",
      "",
      "",
      ...meta,
    ]),
    ...data.perCustomer.map((row) => [
      "Kunde",
      row.id ?? "",
      row.name,
      "",
      row.name,
      "",
      "",
      "",
      row.orders,
      row.completed,
      csvPercent(row.firstTimeFixRate),
      csvHours(row.workMinutes),
      csvHours(row.travelMinutes),
      csvHours(row.totalMinutes),
      "",
      "",
      csvMoney(row.estimatedRevenueOre),
      "",
      row.estimatedRevenueOrders > 0 ? "contract_price_list" : "missing",
      "",
      "",
      ...meta,
    ]),
    ...data.perOrder.map((row) => [
      "Oppdrag",
      row.reference,
      row.title,
      row.departmentName,
      row.customerName,
      row.status,
      row.scheduledFor,
      row.technicians,
      1,
      row.status === "COMPLETED" ? 1 : 0,
      row.firstTimeFix === "fixed"
        ? "100.0"
        : row.firstTimeFix === "not_fixed"
          ? "0.0"
          : "",
      csvHours(row.workMinutes),
      csvHours(row.travelMinutes),
      csvHours(row.totalMinutes),
      "",
      "",
      csvMoney(row.estimatedRevenueOre),
      "",
      row.hourlyRateOre === null ? "missing" : "contract_price_list",
      "",
      "",
      ...meta,
    ]),
  ];

  return toCsv(header, rows);
}

export function biCsvFileName(filters: BiFilters): string {
  return `lonnsomhet-${filters.from}-${filters.to}.csv`;
}
