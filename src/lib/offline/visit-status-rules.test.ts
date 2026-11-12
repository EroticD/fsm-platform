import { describe, expect, it } from "vitest";
import {
  OFFLINE_VISIT_STATUSES,
  VISIT_STATUS_MAX_AGE_MS,
  VISIT_STATUS_MAX_FUTURE_MS,
  isOfflineVisitStatus,
  visitStatusKey,
  visitStatusTimestampProblem,
} from "./visit-status-rules";

const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);

describe("visitStatusTimestampProblem", () => {
  it("godtar et tidspunkt rett rundt nå", () => {
    expect(visitStatusTimestampProblem(NOW, NOW)).toBeNull();
    expect(visitStatusTimestampProblem(NOW - 3 * 60 * 60_000, NOW)).toBeNull();
  });

  it("godtar grensene inklusivt", () => {
    expect(
      visitStatusTimestampProblem(NOW - VISIT_STATUS_MAX_AGE_MS, NOW),
    ).toBeNull();
    expect(
      visitStatusTimestampProblem(NOW + VISIT_STATUS_MAX_FUTURE_MS, NOW),
    ).toBeNull();
  });

  it("avviser et tidspunkt eldre enn ett døgn", () => {
    expect(
      visitStatusTimestampProblem(NOW - VISIT_STATUS_MAX_AGE_MS - 1, NOW),
    ).toBe("too-old");
  });

  it("avviser et tidspunkt mer enn fem minutter fram i tid", () => {
    expect(
      visitStatusTimestampProblem(NOW + VISIT_STATUS_MAX_FUTURE_MS + 1, NOW),
    ).toBe("in-future");
  });

  it("avviser manglende og ugyldige verdier", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(visitStatusTimestampProblem(value, NOW)).toBe("invalid");
    }
  });
});

describe("offline-statuser", () => {
  it("støtter avreise og ankomst, men ikke fullføring", () => {
    expect([...OFFLINE_VISIT_STATUSES]).toEqual(["EN_ROUTE", "ON_SITE"]);
    expect(isOfflineVisitStatus("EN_ROUTE")).toBe(true);
    expect(isOfflineVisitStatus("ON_SITE")).toBe(true);
    expect(isOfflineVisitStatus("DONE")).toBe(false);
    expect(isOfflineVisitStatus("CANCELLED")).toBe(false);
  });

  it("gir samme idempotensnøkkel for samme visitt, status og tidspunkt", () => {
    expect(visitStatusKey("visit-1", "ON_SITE", 1_700_000_000_000)).toBe(
      visitStatusKey("visit-1", "ON_SITE", 1_700_000_000_000),
    );
    expect(visitStatusKey("visit-1", "ON_SITE", 1_700_000_000_000)).not.toBe(
      visitStatusKey("visit-2", "ON_SITE", 1_700_000_000_000),
    );
  });
});
