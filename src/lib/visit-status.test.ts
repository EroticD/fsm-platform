import { describe, expect, it } from "vitest";
import { VisitStatus } from "@prisma/client";
import {
  TERMINAL_VISIT_STATUSES,
  VISIT_STATUS_LABEL_KEYS,
  VISIT_STATUS_ORDER,
  VISIT_STATUS_TRANSITIONS,
  allowedVisitTransitions,
  canTransitionVisit,
  isTerminalVisitStatus,
  visitStatusLabelKey,
} from "./visit-status";

const ALL_STATUSES = Object.values(VisitStatus);

const EXPECTED_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  PLANNED: ["ASSIGNED", "EN_ROUTE", "CANCELLED"],
  ASSIGNED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ON_SITE", "CANCELLED"],
  ON_SITE: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

describe("visittstatuser", () => {
  it("dekker alle statuser i visningsrekkefølgen", () => {
    expect([...VISIT_STATUS_ORDER].sort()).toEqual([...ALL_STATUSES].sort());
    expect(Object.keys(VISIT_STATUS_TRANSITIONS).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });

  it("merker bare DONE og CANCELLED som terminale", () => {
    for (const status of ALL_STATUSES) {
      expect(isTerminalVisitStatus(status)).toBe(
        status === "DONE" || status === "CANCELLED",
      );
    }
    expect([...TERMINAL_VISIT_STATUSES].sort()).toEqual(["CANCELLED", "DONE"]);
  });
});

describe("canTransitionVisit", () => {
  it("tillater nøyaktig overgangene i tabellen", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransitionVisit(from, to)).toBe(
          EXPECTED_TRANSITIONS[from].includes(to),
        );
      }
    }
  });

  it("tillater planlagt visitt å bli tildelt, startet eller kansellert", () => {
    expect(canTransitionVisit("PLANNED", "ASSIGNED")).toBe(true);
    expect(canTransitionVisit("PLANNED", "EN_ROUTE")).toBe(true);
    expect(canTransitionVisit("PLANNED", "CANCELLED")).toBe(true);
    expect(canTransitionVisit("PLANNED", "ON_SITE")).toBe(false);
    expect(canTransitionVisit("PLANNED", "DONE")).toBe(false);
  });

  it("følger montørens flyt fra tildelt til fullført", () => {
    expect(canTransitionVisit("ASSIGNED", "EN_ROUTE")).toBe(true);
    expect(canTransitionVisit("EN_ROUTE", "ON_SITE")).toBe(true);
    expect(canTransitionVisit("ON_SITE", "DONE")).toBe(true);
  });

  it("avviser hopp bakover og over tilstander", () => {
    expect(canTransitionVisit("ASSIGNED", "PLANNED")).toBe(false);
    expect(canTransitionVisit("EN_ROUTE", "ASSIGNED")).toBe(false);
    expect(canTransitionVisit("ON_SITE", "EN_ROUTE")).toBe(false);
    expect(canTransitionVisit("ASSIGNED", "ON_SITE")).toBe(false);
    expect(canTransitionVisit("ASSIGNED", "DONE")).toBe(false);
  });

  it("avviser overgang til samme status", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionVisit(status, status)).toBe(false);
    }
  });

  it("avviser alle overganger fra en terminal tilstand", () => {
    for (const from of TERMINAL_VISIT_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransitionVisit(from, to)).toBe(false);
      }
      expect(allowedVisitTransitions(from)).toEqual([]);
    }
  });
});

describe("allowedVisitTransitions", () => {
  it("returnerer samme valg som canTransitionVisit godtar", () => {
    for (const from of ALL_STATUSES) {
      const allowed = allowedVisitTransitions(from);
      expect(allowed).toEqual(EXPECTED_TRANSITIONS[from]);
      expect(new Set(allowed).size).toBe(allowed.length);
      for (const to of ALL_STATUSES) {
        expect(allowed.includes(to)).toBe(canTransitionVisit(from, to));
      }
    }
  });

  it("returnerer en kopi som ikke endrer tabellen", () => {
    const allowed = allowedVisitTransitions("PLANNED");
    allowed.push("DONE");
    expect(canTransitionVisit("PLANNED", "DONE")).toBe(false);
  });
});

describe("visitStatusLabelKey", () => {
  it("gir en unik i18n-nøkkel for hver status", () => {
    const keys = ALL_STATUSES.map(visitStatusLabelKey);
    expect(new Set(keys).size).toBe(ALL_STATUSES.length);
    for (const status of ALL_STATUSES) {
      expect(visitStatusLabelKey(status)).toBe(VISIT_STATUS_LABEL_KEYS[status]);
      expect(visitStatusLabelKey(status)).toMatch(/^visits\.status\./);
    }
  });
});
