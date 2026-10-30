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
};

export type OptimisedRoute = {
  order: RouteWindow[];
  skipped: string[];
  totalDistanceKm: number;
  totalTravelMinutes: number;
  finishAt: Date | null;
};

type Schedule = {
  order: RouteWindow[];
  skipped: string[];
  travel: number;
  distance: number;
  finishAt: Date;
  feasible: boolean;
};

function minutes(value: Date): number {
  return value.getTime() / 60_000;
}

function serviceFor(visit: RouteWindow): number {
  if (typeof visit.serviceMinutes === "number") {
    return Math.max(0, visit.serviceMinutes);
  }
  return Math.max(0, minutes(visit.endsAt) - minutes(visit.startsAt));
}

/**
 * Bygger en kjøreplan for en gitt rekkefølge. En visitt som ikke kan nås
 * innenfor tidsvinduet hoppes over i stedet for å bryte vinduet. Da kan
 * ruteoptimaliseringen aldri flytte en jobb utenfor avtalt tid.
 */
function schedule(
  visits: RouteWindow[],
  matrix: TravelEstimate[][],
  indexById: Map<string, number>,
  start: Coordinates | null,
  startAt: Date,
  startIndex: number,
): Schedule {
  const ordered: RouteWindow[] = [];
  const skipped: string[] = [];
  let cursor = startIndex;
  let clock = startAt;
  let travel = 0;
  let distance = 0;

  for (const visit of visits) {
    const target = indexById.get(visit.id);
    if (target === undefined || !visit.point) {
      skipped.push(visit.id);
      continue;
    }

    const leg =
      cursor >= 0
        ? matrix[cursor]?.[target]
        : start
          ? matrix[startIndex]?.[target]
          : undefined;
    if (!leg) {
      skipped.push(visit.id);
      continue;
    }

    const arrival = new Date(clock.getTime() + leg.durationMinutes * 60_000);
    const service = serviceFor(visit);
    const earliest = visit.startsAt;
    const latestStart = new Date(visit.endsAt.getTime() - service * 60_000);
    const startTime = new Date(Math.max(arrival.getTime(), earliest.getTime()));

    if (startTime.getTime() > latestStart.getTime()) {
      skipped.push(visit.id);
      continue;
    }

    travel += leg.durationMinutes;
    distance += leg.distanceKm;
    ordered.push(visit);
    clock = new Date(startTime.getTime() + service * 60_000);
    cursor = target;
  }

  return {
    order: ordered,
    skipped,
    travel: Math.round(travel),
    distance: Math.round(distance * 1000) / 1000,
    finishAt: clock,
    feasible: skipped.length === 0,
  };
}

/**
 * Nearest-neighbour + 2-opt over dagens visiter. Rekkefølgen er deterministisk:
 * lik reisetid brytes på visitt-id. Hvis en bedre rekkefølge ikke er mulig
 * innenfor tidsvinduene, beholder vi den forrige. Funksjonen er ren og gjør
 * ingen database- eller nettverkskall.
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
}): OptimisedRoute {
  const visits = input.visits.filter((visit) => visit.point);
  if (visits.length === 0) {
    return {
      order: [],
      skipped: input.visits.map((visit) => visit.id),
      totalDistanceKm: 0,
      totalTravelMinutes: 0,
      finishAt: input.startAt,
    };
  }

  const offset = input.start ? 1 : 0;
  const indexById =
    input.indexById ??
    new Map(visits.map((visit, index) => [visit.id, index + offset]));
  const remaining = [...visits].sort((a, b) => a.id.localeCompare(b.id));
  const greedy: RouteWindow[] = [];
  let cursor = input.startIndex;
  let clock = input.startAt;

  while (remaining.length > 0) {
    let best: { visit: RouteWindow; index: number; leg: TravelEstimate } | null =
      null;

    for (const visit of remaining) {
      const target = indexById.get(visit.id);
      if (target === undefined) continue;
      const leg = input.matrix[cursor]?.[target];
      if (!leg) continue;
      const arrival = clock.getTime() + leg.durationMinutes * 60_000;
      const service = serviceFor(visit);
      const latestStart = visit.endsAt.getTime() - service * 60_000;
      if (arrival > latestStart) continue;

      if (
        !best ||
        leg.durationMinutes < best.leg.durationMinutes ||
        (leg.durationMinutes === best.leg.durationMinutes &&
          visit.id.localeCompare(best.visit.id) < 0)
      ) {
        best = { visit, index: target, leg };
      }
    }

    if (!best) break;
    greedy.push(best.visit);
    remaining.splice(remaining.indexOf(best.visit), 1);
    clock = new Date(
      Math.max(
        clock.getTime() + best.leg.durationMinutes * 60_000,
        best.visit.startsAt.getTime(),
      ) +
        serviceFor(best.visit) * 60_000,
    );
    cursor = best.index;
  }

  let bestSchedule = schedule(
    greedy,
    input.matrix,
    indexById,
    input.start,
    input.startAt,
    input.startIndex,
  );

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
          input.start,
          input.startAt,
          input.startIndex,
        );
        if (next.feasible && next.travel < bestSchedule.travel) {
          bestSchedule = next;
          improved = true;
        }
      }
    }
  }

  return {
    order: bestSchedule.order,
    skipped: visits
      .filter(
        (visit) => !bestSchedule.order.some((row) => row.id === visit.id),
      )
      .map((visit) => visit.id),
    totalDistanceKm: bestSchedule.distance,
    totalTravelMinutes: bestSchedule.travel,
    finishAt: bestSchedule.finishAt,
  };
}
