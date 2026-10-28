import { describe, expect, it } from "vitest";
import { WorkStatus } from "@prisma/client";
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  allowedTransitions,
  canTransition,
  isClosedStatus,
  isOpenStatus,
  statusSelectOptions,
} from "./work-order-status";

const ALL_STATUSES = Object.values(WorkStatus);

describe("statuskategorier", () => {
  it("deler alle statuser i åpne og lukkede", () => {
    expect([...OPEN_STATUSES, ...CLOSED_STATUSES].sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
    for (const status of OPEN_STATUSES) {
      expect(isOpenStatus(status)).toBe(true);
      expect(isClosedStatus(status)).toBe(false);
    }
    for (const status of CLOSED_STATUSES) {
      expect(isClosedStatus(status)).toBe(true);
      expect(isOpenStatus(status)).toBe(false);
    }
  });
});

describe("canTransition", () => {
  it("tillater alle bytter mellom åpne statuser", () => {
    for (const from of OPEN_STATUSES) {
      for (const to of OPEN_STATUSES) {
        if (from === to) continue;
        expect(canTransition(from, to, false)).toBe(true);
      }
    }
  });

  it("tillater at et åpent oppdrag fullføres eller kanselleres", () => {
    for (const from of OPEN_STATUSES) {
      expect(canTransition(from, "COMPLETED", false)).toBe(true);
      expect(canTransition(from, "CANCELLED", false)).toBe(true);
    }
  });

  it("avviser endring av et lukket oppdrag for ikke-admin", () => {
    for (const from of CLOSED_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to, false)).toBe(false);
      }
    }
  });

  it("lar administrator gjenåpne lukkede oppdrag", () => {
    for (const from of CLOSED_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        expect(canTransition(from, to, true)).toBe(true);
      }
    }
  });

  it("avviser overgang til samme status", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status, false)).toBe(false);
      expect(canTransition(status, status, true)).toBe(false);
    }
  });
});

describe("allowedTransitions", () => {
  it("tilbyr alle andre statuser fra en åpen status", () => {
    for (const from of OPEN_STATUSES) {
      expect(allowedTransitions(from, false)).toEqual(
        ALL_STATUSES.filter((status) => status !== from),
      );
    }
  });

  it("tilbyr ingen valg fra en lukket status for ikke-admin", () => {
    for (const from of CLOSED_STATUSES) {
      expect(allowedTransitions(from, false)).toEqual([]);
    }
  });

  it("lar administrator velge alle andre statuser fra en lukket tilstand", () => {
    for (const from of CLOSED_STATUSES) {
      const options = allowedTransitions(from, true);
      expect(options).toEqual(ALL_STATUSES.filter((status) => status !== from));
      expect(options).not.toContain(from);
    }
  });
});

describe("statusSelectOptions", () => {
  it("tilbyr WAITING fra PLANNED og IN_PROGRESS", () => {
    for (const from of ["PLANNED", "IN_PROGRESS"] as const) {
      const options = statusSelectOptions(from, false);

      expect(options).toContain("WAITING");
      expect(canTransition(from, "WAITING", false)).toBe(true);
      expect(options).not.toContain(from);
    }
  });

  it("tilbyr aldri PENDING som et manuelt statusvalg", () => {
    for (const from of OPEN_STATUSES) {
      expect(statusSelectOptions(from, false)).not.toContain("PENDING");
      expect(statusSelectOptions(from, true)).not.toContain("PENDING");
    }
  });

  it("tilbyr bare statuser som canTransition godtar", () => {
    for (const from of ALL_STATUSES) {
      for (const isAdmin of [false, true]) {
        for (const to of statusSelectOptions(from, isAdmin)) {
          expect(canTransition(from, to, isAdmin)).toBe(true);
        }
      }
    }
  });

  it("har en stabil rekkefølge uten gjeldende status", () => {
    expect(statusSelectOptions("PLANNED", false)).toEqual([
      "OPEN",
      "WAITING",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
    ]);
    expect(statusSelectOptions("IN_PROGRESS", false)).toEqual([
      "OPEN",
      "PLANNED",
      "WAITING",
      "COMPLETED",
      "CANCELLED",
    ]);
  });

  it("gir ingen valg fra en lukket status for ikke-admin", () => {
    for (const from of CLOSED_STATUSES) {
      expect(statusSelectOptions(from, false)).toEqual([]);
    }
  });

  it("lar administrator gjenåpne lukkede oppdrag til åpne statuser", () => {
    for (const from of CLOSED_STATUSES) {
      const options = statusSelectOptions(from, true);

      expect(options).toEqual(
        expect.arrayContaining(["OPEN", "PLANNED", "WAITING", "IN_PROGRESS"]),
      );
      expect(options).not.toContain("PENDING");
      expect(options).not.toContain(from);
    }
  });
});
