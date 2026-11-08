import type { Coordinates } from "@/lib/geo";
import type { TravelEstimate } from "./types";

export type RouteWindow = {
  id: string;
  point: Coordinates | null;
  /** Tidligste starttidspunkt. */
  startsAt: Date;
  /** Seneste slutttidspunkt (inklusiv vinduet). */
  endsAt: Date;
  /** Tjenestetid. Standard er hele vinduets lengde. */
  serviceMinutes?: number;
  /**
   * Prioritet 0–3. Høyere verdi gjør at visitten foretrekkes tidligere i
   * nærmeste-nabo-valget. Standard er 0.
   */
  priority?: number;
  /** Kompetansekrav. Tom liste betyr ingen krav. */
  requiredSkillIds?: string[];
};

/**
 * Årsaker til at en visitt ikke kan planlegges i det hele tatt. Tidsvindu og
 * arbeidstid er bevisst ikke blant dem: de gir overtid, ikke ufordelt visitt.
 */
export type RouteUnassignedReason =
  | "missing_coordinates"
  | "missing_skills"
  | "overtime_limit"
  | "ineligible";

export type RouteUnassigned = {
  id: string;
  reason: RouteUnassignedReason;
};

/** Ett stopp i den beregnede kjøreplanen. */
export type RouteStop = {
  visit: RouteWindow;
  /** Når montøren faktisk ankommer stedet. */
  arrivalAt: Date;
  /** Når jobben starter (aldri før visittens tidligste start). */
  startsAt: Date;
  /** Når jobben er ferdig. */
  endsAt: Date;
  /** Ventetid før jobben kan starte innenfor tidsvinduet. */
  waitMinutes: number;
  travelMinutes: number;
  distanceKm: number;
  /** Tjenestetid som faller etter arbeidstidens slutt. */
  overtimeMinutes: number;
  /** True når jobben starter etter visittens tidsvindu. */
  outsideTimeWindow: boolean;
  /** True når jobben varer forbi arbeidstidens slutt. */
  outsideWorkingHours: boolean;
};

export type RouteBaseline = {
  /** Rekkefølgen slik den var planlagt før optimalisering. */
  order: string[];
  totalTravelMinutes: number;
  totalDistanceKm: number;
  totalWaitingMinutes: number;
  totalOvertimeMinutes: number;
};

export type OptimisedRoute = {
  order: RouteWindow[];
  /** Visiter som ikke fikk plass, i innsendt rekkefølge. */
  skipped: string[];
  /** Samme visiter med en stabil årsak. */
  unassigned: RouteUnassigned[];
  totalDistanceKm: number;
  totalTravelMinutes: number;
  /** Sum ventetid før visittenes tidsvindu åpner. */
  totalWaitingMinutes: number;
  /** Sum tjenestetid etter arbeidstidens slutt. */
  totalOvertimeMinutes: number;
  stops: RouteStop[];
  finishAt: Date | null;
  /** Beregnet kjøretid/avstand for den opprinnelige rekkefølgen. */
  baseline: RouteBaseline;
  baselineTravelMinutes: number;
  baselineDistanceKm: number;
  baselineOvertimeMinutes: number;
  savedTravelMinutes: number;
  savedDistanceKm: number;
  /** True når optimaliseringen faktisk endret rekkefølgen. */
  changed: boolean;
};

type Schedule = {
  order: RouteWindow[];
  unassigned: RouteUnassigned[];
  travel: number;
  distance: number;
  waiting: number;
  overtime: number;
  stops: RouteStop[];
  finishAt: Date;
};

type ScheduleOptions = {
  start: Coordinates | null;
  startAt: Date;
  startIndex: number;
  workingStart: Date | null;
  workingEnd: Date | null;
  allowOvertime: boolean;
  maxOvertimeMinutes: number;
};

const DEFAULT_PRIORITY_WEIGHT_MINUTES = 5;

function minutes(value: Date): number {
  return value.getTime() / 60_000;
}

function serviceFor(visit: RouteWindow): number {
  if (typeof visit.serviceMinutes === "number") {
    return Math.max(0, visit.serviceMinutes);
  }
  return Math.max(0, minutes(visit.endsAt) - minutes(visit.startsAt));
}

function priorityFor(visit: RouteWindow): number {
  const value = Number(visit.priority ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.min(3, Math.max(0, Math.round(value)));
}

function missingSkills(
  visit: RouteWindow,
  technicianSkillIds: readonly string[] | undefined,
): boolean {
  if (technicianSkillIds === undefined) return false;
  const required = visit.requiredSkillIds ?? [];
  if (required.length === 0) return false;
  const available = new Set(technicianSkillIds);
  return required.some((skillId) => !available.has(skillId));
}

function effectiveStart(startAt: Date, workingStart: Date | null): Date {
  return workingStart && workingStart.getTime() > startAt.getTime()
    ? workingStart
    : startAt;
}

/**
 * Tjenestetid som faller etter arbeidstidens slutt. En visitt som starter
 * etter arbeidstid teller bare selve tjenestetiden, ikke reise-/ventetid før.
 */
function overtimeFor(
  startsAt: Date,
  endsAt: Date,
  workingEnd: Date | null,
): { rawMs: number; minutes: number } {
  if (!workingEnd || endsAt.getTime() <= workingEnd.getTime()) {
    return { rawMs: 0, minutes: 0 };
  }
  const rawMs = Math.max(
    0,
    endsAt.getTime() - Math.max(startsAt.getTime(), workingEnd.getTime()),
  );
  return { rawMs, minutes: Math.ceil(rawMs / 60_000) };
}

/**
 * Bygger en kjøreplan for en gitt rekkefølge. Visiter som havner utenfor
 * tidsvinduet eller arbeidstiden planlegges fortsatt, og merkes med overtid.
 * Bare visiter som mangler koordinater/matrise, eller som bryter en
 * konfigurert hard overtidsgrense, rapporteres som ufordelte.
 */
function schedule(
  visits: RouteWindow[],
  matrix: TravelEstimate[][],
  indexById: Map<string, number>,
  options: ScheduleOptions,
): Schedule {
  const ordered: RouteWindow[] = [];
  const unassigned: RouteUnassigned[] = [];
  const stops: RouteStop[] = [];
  let cursor = options.startIndex;
  let clock = effectiveStart(options.startAt, options.workingStart);
  let travel = 0;
  let distance = 0;
  let waiting = 0;
  let overtime = 0;

  for (const visit of visits) {
    const target = indexById.get(visit.id);
    if (target === undefined || !visit.point) {
      unassigned.push({
        id: visit.id,
        reason: !visit.point ? "missing_coordinates" : "ineligible",
      });
      continue;
    }

    const leg =
      cursor >= 0
        ? matrix[cursor]?.[target]
        : options.start
          ? matrix[options.startIndex]?.[target]
          : undefined;
    if (!leg) {
      unassigned.push({ id: visit.id, reason: "ineligible" });
      continue;
    }

    const arrival = new Date(clock.getTime() + leg.durationMinutes * 60_000);
    const service = serviceFor(visit);
    const earliest = visit.startsAt;
    const latestStart = new Date(visit.endsAt.getTime() - service * 60_000);
    const startTime = new Date(
      Math.max(arrival.getTime(), earliest.getTime(), clock.getTime()),
    );
    const endTime = new Date(startTime.getTime() + service * 60_000);
    const outsideTimeWindow = startTime.getTime() > latestStart.getTime();
    const stopOvertime = overtimeFor(startTime, endTime, options.workingEnd);
    const outsideWorkingHours = stopOvertime.rawMs > 0;

    // En hard grense eller avslått overtid er de eneste tidsårsakene som
    // fortsatt kan holde en lokalisert visitt utenfor planen.
    if (!options.allowOvertime && outsideWorkingHours) {
      unassigned.push({ id: visit.id, reason: "overtime_limit" });
      continue;
    }
    if (
      options.maxOvertimeMinutes > 0 &&
      overtime + stopOvertime.minutes > options.maxOvertimeMinutes
    ) {
      unassigned.push({ id: visit.id, reason: "overtime_limit" });
      continue;
    }

    const waitMinutes = Math.max(
      0,
      Math.round((startTime.getTime() - arrival.getTime()) / 60_000),
    );
    travel += leg.durationMinutes;
    distance += leg.distanceKm;
    waiting += waitMinutes;
    overtime += stopOvertime.minutes;
    ordered.push(visit);
    stops.push({
      visit,
      arrivalAt: arrival,
      startsAt: startTime,
      endsAt: endTime,
      waitMinutes,
      travelMinutes: leg.durationMinutes,
      distanceKm: leg.distanceKm,
      overtimeMinutes: stopOvertime.minutes,
      outsideTimeWindow,
      outsideWorkingHours,
    });
    clock = endTime;
    cursor = target;
  }

  return {
    order: ordered,
    unassigned,
    travel: Math.round(travel),
    distance: Math.round(distance * 1000) / 1000,
    waiting: Math.round(waiting),
    overtime: Math.round(overtime),
    stops,
    finishAt: clock,
  };
}

function uniqueUnassigned(rows: RouteUnassigned[]): RouteUnassigned[] {
  const seen = new Set<string>();
  const result: RouteUnassigned[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

/**
 * True når `candidate` er en bedre kjøreplan enn `current`: færrest ufordelte,
 * deretter minst overtid, til slutt kortest kjøretid. Da kan 2-opt aldri bytte
 * bort en løsning med mindre overtid mot bare litt kortere kjøring.
 */
function isBetterSchedule(candidate: Schedule, current: Schedule): boolean {
  if (candidate.unassigned.length !== current.unassigned.length) {
    return candidate.unassigned.length < current.unassigned.length;
  }
  if (candidate.overtime !== current.overtime) {
    return candidate.overtime < current.overtime;
  }
  return candidate.travel < current.travel;
}

/**
 * Nearest-neighbour + 2-opt over dagens visiter.
 *
 * - Tidsvinduer og arbeidstid blokkerer ikke lenger planlegging. En visitt som
 *   ikke rekker vinduet, eller som varer forbi arbeidstidens slutt, planlegges
 *   med `outsideTimeWindow`/`outsideWorkingHours` og overtidsminutter.
 * - `allowOvertime=false` eller en positiv `maxOvertimeMinutes` kan likevel
 *   avvise en visitt som `overtime_limit`. Standard er å tillate all overtid.
 * - Kompetansekrav filtreres før ruten beregnes når montørens kompetanse er
 *   oppgitt. Manglende koordinater og kompetanse er de eneste faste
 *   forhåndsfiltrene.
 * - Prioritet (0–3) trekker en visitt fram i nærmeste-nabo-valget. 2-opt
 *   forbedrer deretter kjørelengden uten å øke overtiden.
 *
 * Rekkefølgen er deterministisk: lik reisetid brytes på prioritet, deretter
 * visitt-id. Funksjonen er ren og gjør ingen database- eller nettverkskall.
 */
export function optimiseRoute(input: {
  visits: RouteWindow[];
  matrix: TravelEstimate[][];
  start: Coordinates | null;
  startAt: Date;
  startIndex: number;
  /** Matriseindeks per visitt. Standard: startraden er 0, deretter visitene. */
  indexById?: Map<string, number>;
  /** Sikkerhetsgrense for 2-opt; standard er 200 iterasjoner. */
  maxIterations?: number;
  /** Arbeidstid for dagen. Ingen grense når den er utelatt. */
  workingHours?: { start: Date; end: Date } | null;
  /** Montørens gyldige kompetanse. Utelatt betyr «ikke kontroller». */
  technicianSkillIds?: readonly string[];
  /** Minutter høyere prioritet kan «spare» i nærmeste-nabo-valget. */
  priorityWeightMinutes?: number;
  /** Standard true. False gjør at arbeid etter arbeidstid ikke planlegges. */
  allowOvertime?: boolean;
  /** 0 betyr ingen grense. Positiv verdi er tak for total overtid i ruten. */
  maxOvertimeMinutes?: number;
}): OptimisedRoute {
  const workingStart = input.workingHours?.start ?? null;
  const workingEnd = input.workingHours?.end ?? null;
  const baselineStart = effectiveStart(input.startAt, workingStart);
  const allowOvertime = input.allowOvertime ?? true;
  const maxOvertimeMinutes = Math.max(
    0,
    Math.round(input.maxOvertimeMinutes ?? 0),
  );

  const eligible: RouteWindow[] = [];
  const prefiltered: RouteUnassigned[] = [];
  for (const visit of input.visits) {
    if (!visit.point) {
      prefiltered.push({ id: visit.id, reason: "missing_coordinates" });
      continue;
    }
    if (missingSkills(visit, input.technicianSkillIds)) {
      prefiltered.push({ id: visit.id, reason: "missing_skills" });
      continue;
    }
    eligible.push(visit);
  }

  const offset = input.start ? 1 : 0;
  const indexById =
    input.indexById ??
    new Map(eligible.map((visit, index) => [visit.id, index + offset]));

  const emptyBaseline: RouteBaseline = {
    order: [],
    totalTravelMinutes: 0,
    totalDistanceKm: 0,
    totalWaitingMinutes: 0,
    totalOvertimeMinutes: 0,
  };

  if (eligible.length === 0) {
    return {
      order: [],
      skipped: input.visits.map((visit) => visit.id),
      unassigned: uniqueUnassigned(prefiltered),
      totalDistanceKm: 0,
      totalTravelMinutes: 0,
      totalWaitingMinutes: 0,
      totalOvertimeMinutes: 0,
      stops: [],
      finishAt: baselineStart,
      baseline: emptyBaseline,
      baselineTravelMinutes: 0,
      baselineDistanceKm: 0,
      baselineOvertimeMinutes: 0,
      savedTravelMinutes: 0,
      savedDistanceKm: 0,
      changed: false,
    };
  }

  const scheduleOptions: ScheduleOptions = {
    start: input.start,
    startAt: input.startAt,
    startIndex: input.startIndex,
    workingStart,
    workingEnd,
    allowOvertime,
    maxOvertimeMinutes,
  };

  // «Før»-bildet er dagens rekkefølge, ikke en sortert kopi. Da kan
  // kontoret se nøyaktig hva optimaliseringen sparte.
  const baselineSchedule = schedule(
    eligible,
    input.matrix,
    indexById,
    scheduleOptions,
  );

  const remaining = [...eligible];
  const greedy: RouteWindow[] = [];
  let cursor = input.startIndex;
  let clock = baselineStart;
  const priorityWeight = Math.min(
    30,
    Math.max(0, input.priorityWeightMinutes ?? DEFAULT_PRIORITY_WEIGHT_MINUTES),
  );

  while (remaining.length > 0) {
    let best: {
      visit: RouteWindow;
      index: number;
      leg: TravelEstimate;
      score: number;
      feasible: boolean;
      overtime: number;
      arrival: Date;
    } | null = null;

    for (const visit of remaining) {
      const target = indexById.get(visit.id);
      if (target === undefined) continue;
      const leg = input.matrix[cursor]?.[target];
      if (!leg) continue;
      const arrival = new Date(
        clock.getTime() + leg.durationMinutes * 60_000,
      );
      const service = serviceFor(visit);
      const startTime = new Date(
        Math.max(arrival.getTime(), visit.startsAt.getTime(), clock.getTime()),
      );
      const endTime = new Date(startTime.getTime() + service * 60_000);
      const latestStart = visit.endsAt.getTime() - service * 60_000;
      const overtime = overtimeFor(startTime, endTime, workingEnd).minutes;
      const feasible =
        startTime.getTime() <= latestStart && overtime === 0;

      const priority = priorityFor(visit);
      const score = Math.max(
        0,
        leg.durationMinutes - priority * priorityWeight,
      );

      const better =
        !best ||
        (feasible !== best.feasible
          ? feasible
          : !feasible && overtime !== best.overtime
            ? overtime < best.overtime
            : score < best.score ||
              (score === best.score &&
                leg.durationMinutes < best.leg.durationMinutes) ||
              (score === best.score &&
                leg.durationMinutes === best.leg.durationMinutes &&
                priority > priorityFor(best.visit)) ||
              (score === best.score &&
                leg.durationMinutes === best.leg.durationMinutes &&
                priority === priorityFor(best.visit) &&
                visit.id.localeCompare(best.visit.id) < 0));

      if (better) {
        best = {
          visit,
          index: target,
          leg,
          score,
          feasible,
          overtime,
          arrival,
        };
      }
    }

    if (!best) break;
    greedy.push(best.visit);
    remaining.splice(remaining.indexOf(best.visit), 1);
    const service = serviceFor(best.visit);
    clock = new Date(
      Math.max(best.arrival.getTime(), best.visit.startsAt.getTime()) +
        service * 60_000,
    );
    cursor = best.index;
  }

  let bestSchedule = schedule(
    greedy,
    input.matrix,
    indexById,
    scheduleOptions,
  );

  // Visiter som nærmeste-nabo ikke tok med, mangler en matriserad og kan ikke
  // lokaliseres. Alle andre årsaker rapporteres allerede av `schedule`.
  const greedyUnassigned: RouteUnassigned[] = remaining.map((visit) => ({
    id: visit.id,
    reason: "ineligible" as const,
  }));

  const maxIterations = input.maxIterations ?? 200;
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations && bestSchedule.order.length > 2) {
    improved = false;
    iterations += 1;

    for (let i = 0; i < bestSchedule.order.length - 1; i += 1) {
      for (let j = i + 1; j < bestSchedule.order.length; j += 1) {
        const candidate = [
          ...bestSchedule.order.slice(0, i),
          ...bestSchedule.order.slice(i, j + 1).reverse(),
          ...bestSchedule.order.slice(j + 1),
        ];
        const next = schedule(
          candidate,
          input.matrix,
          indexById,
          scheduleOptions,
        );
        if (isBetterSchedule(next, bestSchedule)) {
          bestSchedule = next;
          improved = true;
        }
      }
    }
  }

  const unassigned = uniqueUnassigned([
    ...prefiltered,
    ...greedyUnassigned,
    ...bestSchedule.unassigned,
  ]);
  const skipped = input.visits
    .map((visit) => visit.id)
    .filter((id) => !bestSchedule.order.some((row) => row.id === id));

  const baselineTravel = Math.round(baselineSchedule.travel);
  const baselineDistance =
    Math.round(baselineSchedule.distance * 1000) / 1000;
  const changed =
    baselineSchedule.order.length !== bestSchedule.order.length ||
    baselineSchedule.order.some(
      (visit, index) => visit.id !== bestSchedule.order[index]?.id,
    );

  return {
    order: bestSchedule.order,
    skipped,
    unassigned,
    totalDistanceKm: bestSchedule.distance,
    totalTravelMinutes: bestSchedule.travel,
    totalWaitingMinutes: bestSchedule.waiting,
    totalOvertimeMinutes: bestSchedule.overtime,
    stops: bestSchedule.stops,
    finishAt: bestSchedule.finishAt,
    baseline: {
      order: baselineSchedule.order.map((visit) => visit.id),
      totalTravelMinutes: baselineTravel,
      totalDistanceKm: baselineDistance,
      totalWaitingMinutes: baselineSchedule.waiting,
      totalOvertimeMinutes: baselineSchedule.overtime,
    },
    baselineTravelMinutes: baselineTravel,
    baselineDistanceKm: baselineDistance,
    baselineOvertimeMinutes: baselineSchedule.overtime,
    savedTravelMinutes: baselineTravel - bestSchedule.travel,
    savedDistanceKm:
      Math.round((baselineDistance - bestSchedule.distance) * 1000) / 1000,
    changed,
  };
}
