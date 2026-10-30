/**
 * Ren, deterministisk poengberegning for dispatch.
 *
 * Tjenestelaget i `src/server/dispatch.ts` henter data fra databasen og gir dem
 * til denne modulen. Da kan rangeringen testes uten database, nettverk eller
 * klokke, og samme input gir alltid samme rekkefølge.
 */

export type DispatchWeights = {
  skills: number;
  distance: number;
  travel: number;
  free: number;
  sla: number;
  load: number;
};

export const DEFAULT_DISPATCH_WEIGHTS: DispatchWeights = {
  skills: 35,
  distance: 20,
  travel: 15,
  free: 10,
  sla: 10,
  load: 10,
};

export const DISPATCH_POLICY_MODES = [
  "SKILLS",
  "DISTANCE",
  "EARLIEST",
  "CUSTOM",
] as const;

export type DispatchPolicyMode = (typeof DISPATCH_POLICY_MODES)[number];

export function weightsForMode(
  mode: string | null | undefined,
  custom?: Partial<DispatchWeights> | null,
): DispatchWeights {
  const base: DispatchWeights =
    mode === "SKILLS"
      ? { skills: 55, distance: 10, travel: 10, free: 5, sla: 10, load: 10 }
      : mode === "DISTANCE"
        ? { skills: 15, distance: 45, travel: 20, free: 5, sla: 10, load: 5 }
        : mode === "EARLIEST"
          ? { skills: 15, distance: 10, travel: 10, free: 10, sla: 45, load: 10 }
          : DEFAULT_DISPATCH_WEIGHTS;

  return sanitizeWeights({ ...base, ...(custom ?? {}) });
}

function sanitizeWeights(input: Partial<DispatchWeights>): DispatchWeights {
  const result = { ...DEFAULT_DISPATCH_WEIGHTS };
  for (const key of Object.keys(result) as Array<keyof DispatchWeights>) {
    const value = Number(input[key]);
    if (Number.isFinite(value) && value >= 0) result[key] = value;
  }
  return result;
}

export type DispatchCandidateInput = {
  id: string;
  name: string;
  skills: Array<{
    skillId: string;
    level?: number | null;
    validUntil?: Date | null;
  }>;
  availability: Array<{
    weekday: number;
    startMinute: number;
    endMinute: number;
  }>;
  absences: Array<{ startsAt: Date; endsAt: Date }>;
  /** Visiter montøren allerede har denne dagen. */
  assignedVisits: Array<{ startsAt: Date; endsAt: Date }>;
  /** Eksplisitt kapasitet for dagen, hvis den er planlagt. */
  capacityMinutes?: number | null;
  /** Siste kjente posisjon (forrige visitt) for reiseberegning. */
  lastPoint?: { latitude: number; longitude: number } | null;
  /** Ferdig beregnet reise til denne visitten. */
  travel?: { distanceKm: number; durationMinutes: number } | null;
};

export type DispatchVisitInput = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Oslo-veggklokke for visitten, slik at arbeidstid kan vurderes. */
  localWeekday: number;
  startMinute: number;
  endMinute: number;
  requiredSkills: Array<{ skillId: string; mandatory: boolean }>;
  slaRemainingMinutes?: number | null;
  slaBreached?: boolean;
};

export type DispatchScoreBreakdown = {
  skills: number;
  distance: number;
  travel: number;
  free: number;
  sla: number;
  load: number;
};

export type DispatchCandidateScore = {
  id: string;
  name: string;
  score: number;
  eligible: boolean;
  excludedReason:
    | "missing_skills"
    | "absence"
    | "unavailable"
    | "overlap"
    | null;
  missingSkillIds: string[];
  /** Komponentene etter vekting, avrundet til én desimal. */
  breakdown: DispatchScoreBreakdown;
  distanceKm: number | null;
  travelMinutes: number | null;
  freeMinutes: number;
  assignedMinutes: number;
  capacityMinutes: number;
  /** 0–1. */
  currentLoad: number;
  /** 0–100, der 100 er kritisk nær/over fristen. */
  slaUrgency: number;
  /** Rå, uvektet poengsum per komponent (0–100). */
  raw: DispatchScoreBreakdown;
};

export type DispatchRanking = {
  visitId: string;
  candidates: DispatchCandidateScore[];
  best: DispatchCandidateScore | null;
};

const MINUTE_MS = 60_000;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function isAbsent(
  candidate: DispatchCandidateInput,
  visit: DispatchVisitInput,
): boolean {
  return candidate.absences.some((absence) =>
    overlaps(absence, { startsAt: visit.startsAt, endsAt: visit.endsAt }),
  );
}

function isAvailable(
  candidate: DispatchCandidateInput,
  visit: DispatchVisitInput,
): boolean {
  // Uten registrert arbeidstid antar vi at montøren følger avdelingens
  // åpningstider. Da blir ikke nye ansatte usynlige for dispatch før noen
  // rekker å legge inn en ukeplan.
  if (candidate.availability.length === 0) return true;
  return candidate.availability.some(
    (window) =>
      window.weekday === visit.localWeekday &&
      window.startMinute <= visit.startMinute &&
      window.endMinute >= visit.endMinute,
  );
}

function hasOverlap(
  candidate: DispatchCandidateInput,
  visit: DispatchVisitInput,
): boolean {
  return candidate.assignedVisits.some((assigned) =>
    overlaps(assigned, { startsAt: visit.startsAt, endsAt: visit.endsAt }),
  );
}

function assignedMinutesForDay(candidate: DispatchCandidateInput): number {
  return candidate.assignedVisits.reduce(
    (sum, assigned) =>
      sum +
      Math.max(
        0,
        Math.round(
          (assigned.endsAt.getTime() - assigned.startsAt.getTime()) / MINUTE_MS,
        ),
      ),
    0,
  );
}

function capacityForDay(
  candidate: DispatchCandidateInput,
  visit: DispatchVisitInput,
): number {
  if (typeof candidate.capacityMinutes === "number") {
    return Math.max(0, candidate.capacityMinutes);
  }
  return Math.max(0, visit.endMinute - visit.startMinute) || 8 * 60;
}

function scoreOne(
  candidate: DispatchCandidateInput,
  visit: DispatchVisitInput,
  weights: DispatchWeights,
): DispatchCandidateScore {
  const visitStartMs = visit.startsAt.getTime();
  const required = visit.requiredSkills;
  const requiredIds = new Set(
    required.filter((skill) => skill.mandatory).map((skill) => skill.skillId),
  );
  const validSkills = new Map(
    candidate.skills
      .filter(
        (skill) =>
          !skill.validUntil || skill.validUntil.getTime() >= visitStartMs,
      )
      .map((skill) => [skill.skillId, skill]),
  );
  const missingSkillIds = [...requiredIds].filter(
    (skillId) => !validSkills.has(skillId),
  );

  const absent = isAbsent(candidate, visit);
  const available = isAvailable(candidate, visit);
  const overlapping = hasOverlap(candidate, visit);

  let excludedReason: DispatchCandidateScore["excludedReason"] = null;
  if (missingSkillIds.length > 0) excludedReason = "missing_skills";
  else if (absent) excludedReason = "absence";
  else if (!available) excludedReason = "unavailable";
  else if (overlapping) excludedReason = "overlap";

  const matchedOptional = required.filter(
    (skill) => !skill.mandatory && validSkills.has(skill.skillId),
  ).length;
  const skillRaw =
    requiredIds.size === 0
      ? 100
      : 100 - (missingSkillIds.length / requiredIds.size) * 100 + matchedOptional;
  const distanceKm = candidate.travel?.distanceKm ?? null;
  const travelMinutes = candidate.travel?.durationMinutes ?? null;
  const distanceRaw =
    distanceKm === null ? 50 : clamp(100 - distanceKm * 5);
  const travelRaw =
    travelMinutes === null ? 50 : clamp(100 - travelMinutes * 2);
  const capacityMinutes = capacityForDay(candidate, visit);
  const assignedMinutes = assignedMinutesForDay(candidate);
  const freeMinutes = Math.max(0, capacityMinutes - assignedMinutes);
  const visitMinutes = Math.max(
    1,
    Math.round((visit.endsAt.getTime() - visit.startsAt.getTime()) / MINUTE_MS),
  );
  const freeRaw = clamp((freeMinutes / visitMinutes) * 50);
  const slaUrgency = visit.slaBreached
    ? 100
    : typeof visit.slaRemainingMinutes === "number"
      ? clamp(100 - Math.max(0, visit.slaRemainingMinutes) * 0.5)
      : 0;
  const currentLoad =
    capacityMinutes > 0 ? Math.min(1, assignedMinutes / capacityMinutes) : 1;
  const loadRaw = clamp(100 - currentLoad * 100);

  const raw: DispatchScoreBreakdown = {
    skills: round(clamp(skillRaw, 0, 100)),
    distance: round(distanceRaw),
    travel: round(travelRaw),
    free: round(freeRaw),
    sla: round(slaUrgency),
    load: round(loadRaw),
  };
  const breakdown: DispatchScoreBreakdown = {
    skills: round(raw.skills * weights.skills),
    distance: round(raw.distance * weights.distance),
    travel: round(raw.travel * weights.travel),
    free: round(raw.free * weights.free),
    sla: round(raw.sla * weights.sla),
    load: round(raw.load * weights.load),
  };
  const totalWeight =
    weights.skills +
    weights.distance +
    weights.travel +
    weights.free +
    weights.sla +
    weights.load;
  const score =
    totalWeight > 0
      ? round(
          (breakdown.skills +
            breakdown.distance +
            breakdown.travel +
            breakdown.free +
            breakdown.sla +
            breakdown.load) /
            totalWeight,
        )
      : 0;

  return {
    id: candidate.id,
    name: candidate.name,
    score,
    eligible: excludedReason === null,
    excludedReason,
    missingSkillIds,
    breakdown,
    distanceKm:
      distanceKm === null ? null : round(distanceKm, 2),
    travelMinutes,
    freeMinutes,
    assignedMinutes,
    capacityMinutes,
    currentLoad: round(currentLoad, 3),
    slaUrgency: round(slaUrgency),
    raw,
  };
}

/**
 * Rangerer kandidatene. Kvalifiserte kandidater kommer alltid foran
 * ekskluderte; innenfor hver gruppe sorteres det på score og deretter navn/id,
 * slik at resultatet er stabilt mellom kjøringer.
 */
export function rankDispatchCandidates(input: {
  visit: DispatchVisitInput;
  candidates: DispatchCandidateInput[];
  weights?: Partial<DispatchWeights> | null;
  mode?: string | null;
}): DispatchRanking {
  const weights = weightsForMode(input.mode, input.weights);
  const scored = input.candidates.map((candidate) =>
    scoreOne(candidate, input.visit, weights),
  );
  scored.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return (
      (a.name || a.id).localeCompare(b.name || b.id, "nb") ||
      a.id.localeCompare(b.id)
    );
  });

  return {
    visitId: input.visit.id,
    candidates: scored,
    best: scored.find((candidate) => candidate.eligible) ?? null,
  };
}

/** Bygger komponentlisten UI-et viser som «hvorfor denne montøren?». */
export function scoreExplanationKeys(): Array<keyof DispatchScoreBreakdown> {
  return ["skills", "distance", "travel", "free", "sla", "load"];
}
