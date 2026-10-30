import { describe, expect, it } from "vitest";
import {
  rankDispatchCandidates,
  weightsForMode,
  type DispatchCandidateInput,
  type DispatchVisitInput,
} from "./dispatch-scoring";

const visitStart = new Date("2026-11-02T09:00:00.000Z");
const visitEnd = new Date("2026-11-02T11:00:00.000Z");

function visit(overrides: Partial<DispatchVisitInput> = {}): DispatchVisitInput {
  return {
    id: "visit-1",
    startsAt: visitStart,
    endsAt: visitEnd,
    localWeekday: 0,
    startMinute: 10 * 60,
    endMinute: 12 * 60,
    requiredSkills: [{ skillId: "skill-electric", mandatory: true }],
    slaRemainingMinutes: 240,
    slaBreached: false,
    ...overrides,
  };
}

function candidate(
  id: string,
  overrides: Partial<DispatchCandidateInput> = {},
): DispatchCandidateInput {
  return {
    id,
    name: id,
    skills: [{ skillId: "skill-electric", validUntil: null }],
    availability: [],
    absences: [],
    assignedVisits: [],
    capacityMinutes: 8 * 60,
    travel: { distanceKm: 4, durationMinutes: 10 },
    ...overrides,
  };
}

describe("dispatch-scoring", () => {
  it("gir samme rangering for samme input", () => {
    const input = {
      visit: visit(),
      candidates: [
        candidate("alpha", { travel: { distanceKm: 8, durationMinutes: 20 } }),
        candidate("beta", { travel: { distanceKm: 1, durationMinutes: 4 } }),
        candidate("gamma", {
          assignedVisits: [
            {
              startsAt: new Date("2026-11-02T12:00:00.000Z"),
              endsAt: new Date("2026-11-02T15:00:00.000Z"),
            },
          ],
        }),
      ],
    };

    const first = rankDispatchCandidates(input);
    const second = rankDispatchCandidates(input);
    expect(first).toEqual(second);
    expect(first.candidates[0].id).toBe("beta");
    expect(first.candidates).toHaveLength(3);
  });

  it("filtrerer bort montører som mangler påkrevd kompetanse", () => {
    const ranking = rankDispatchCandidates({
      visit: visit(),
      candidates: [
        candidate("uten-kompetanse", { skills: [] }),
        candidate("med-kompetanse"),
      ],
    });

    const missing = ranking.candidates.find(
      (row) => row.id === "uten-kompetanse",
    );
    expect(missing?.eligible).toBe(false);
    expect(missing?.excludedReason).toBe("missing_skills");
    expect(missing?.missingSkillIds).toEqual(["skill-electric"]);
    expect(ranking.best?.id).toBe("med-kompetanse");
  });

  it("utelater montører med fravær i visittens tidsrom", () => {
    const ranking = rankDispatchCandidates({
      visit: visit(),
      candidates: [
        candidate("syk", {
          absences: [
            {
              startsAt: new Date("2026-11-02T08:00:00.000Z"),
              endsAt: new Date("2026-11-02T12:00:00.000Z"),
            },
          ],
        }),
        candidate("frisk"),
      ],
    });

    expect(
      ranking.candidates.find((row) => row.id === "syk")?.excludedReason,
    ).toBe("absence");
    expect(ranking.best?.id).toBe("frisk");
  });

  it("respekterer arbeidstid når den er registrert", () => {
    const ranking = rankDispatchCandidates({
      visit: visit(),
      candidates: [
        candidate("kveld", {
          availability: [
            { weekday: 0, startMinute: 16 * 60, endMinute: 22 * 60 },
          ],
        }),
        candidate("dag"),
      ],
    });

    expect(
      ranking.candidates.find((row) => row.id === "kveld")?.excludedReason,
    ).toBe("unavailable");
    expect(ranking.best?.id).toBe("dag");
  });

  it("gir høyere SLA-vekt i tidligst-modus", () => {
    expect(weightsForMode("EARLIEST").sla).toBeGreaterThan(
      weightsForMode("DISTANCE").sla,
    );
    expect(weightsForMode("CUSTOM", { skills: 99 }).skills).toBe(99);
  });

  it("rangerer 50 montører × 200 visiter under 300 ms", () => {
    const candidates = Array.from({ length: 50 }, (_, index) =>
      candidate(`tech-${index}`, {
        travel: {
          distanceKm: index % 20,
          durationMinutes: index % 30,
        },
        assignedVisits: [],
      }),
    );
    const visits = Array.from({ length: 200 }, (_, index) =>
      visit({ id: `visit-${index}` }),
    );

    const started = performance.now();
    for (const current of visits) {
      rankDispatchCandidates({ visit: current, candidates });
    }
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(300);
  });
});
