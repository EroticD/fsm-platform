import { describe, expect, it } from "vitest";
import { scheduledTodayWhere } from "./work-order-date-where";

const startOfToday = new Date("2026-10-28T00:00:00.000Z");
const endOfToday = new Date("2026-10-29T00:00:00.000Z");

describe("scheduledTodayWhere", () => {
  it("bruker streng lt mot neste dags midnatt, ikke lte", () => {
    const where = scheduledTodayWhere(startOfToday, endOfToday);

    // `lte: endOfToday` ville tatt med oppdrag som starter i morgen kl. 00:00.
    expect(where.scheduledFor).toEqual({ lt: endOfToday });
    expect(where.scheduledFor).not.toEqual({ lte: endOfToday });
  });

  it("tar med flerdagersoppdrag som er i gang i dag", () => {
    const where = scheduledTodayWhere(startOfToday, endOfToday);

    expect(where.OR).toEqual([
      { scheduledTo: { gte: startOfToday } },
      { scheduledTo: null, scheduledFor: { gte: startOfToday } },
    ]);
  });

  it("avgrenser éndagsoppdrag til oppdrag som starter i dag", () => {
    const where = scheduledTodayWhere(startOfToday, endOfToday);
    const sameDay = { scheduledFor: startOfToday, scheduledTo: null };
    const tomorrow = { scheduledFor: endOfToday, scheduledTo: null };

    const matches = (order: { scheduledFor: Date; scheduledTo: Date | null }) => {
      const startsTodayOrEarlier =
        order.scheduledFor < endOfToday; // streng lt
      const coversToday =
        (order.scheduledTo !== null && order.scheduledTo >= startOfToday) ||
        (order.scheduledTo === null && order.scheduledFor >= startOfToday);
      return startsTodayOrEarlier && coversToday;
    };

    expect(where.scheduledFor).toEqual({ lt: endOfToday });
    expect(matches(sameDay)).toBe(true);
    expect(matches(tomorrow)).toBe(false);
  });
});
