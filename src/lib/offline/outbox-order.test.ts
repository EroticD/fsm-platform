import { describe, expect, it } from "vitest";
import {
  isAttemptLimitReached,
  isOutboxReady,
  isOutboxTerminal,
  isPayloadWithinLimit,
  itemReportIdentity,
  MAX_OUTBOX_ATTEMPTS,
  MAX_OUTBOX_PAYLOAD_BYTES,
  newestPerReport,
  payloadByteLength,
  payloadReportIdentity,
  retryDelayMs,
  sortOutboxOldestFirst,
  type OutboxOrderItem,
} from "./outbox-order";

function item(overrides: Partial<OutboxOrderItem>): OutboxOrderItem {
  return {
    id: "id",
    userId: "u1",
    payload: "{}",
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

describe("outbox-order", () => {
  it("leser oppdrag og mal fra payloaden", () => {
    expect(
      payloadReportIdentity(
        JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
      ),
    ).toEqual({ workOrderId: "wo1", templateId: "tpl1" });
    expect(payloadReportIdentity("{")).toBeNull();
    expect(payloadReportIdentity(JSON.stringify({ workOrderId: "wo1" }))).toBeNull();
  });

  it("bruker lagrede id-er før payload-parsing", () => {
    expect(
      itemReportIdentity({
        payload: "{}",
        workOrderId: "wo1",
        templateId: "tpl1",
      }),
    ).toEqual({ workOrderId: "wo1", templateId: "tpl1" });
  });

  it("sorterer eldste først, med stabil id-rekkefølge ved lik tid", () => {
    const sorted = sortOutboxOldestFirst([
      item({ id: "b", createdAt: 5 }),
      item({ id: "a", createdAt: 5 }),
      item({ id: "old", createdAt: 1 }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["old", "a", "b"]);
  });

  it("beholder bare nyeste kladd per rapport og rapporterer eldre som stale", () => {
    const old = item({
      id: "old",
      createdAt: 1,
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: "gammel" }),
    });
    const newest = item({
      id: "new",
      createdAt: 2,
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: "ny" }),
    });
    const other = item({
      id: "other",
      createdAt: 3,
      payload: JSON.stringify({ workOrderId: "wo2", templateId: "tpl1" }),
    });

    const result = newestPerReport([newest, old, other], "u1");

    expect(result.ordered.map((entry) => entry.id)).toEqual(["new", "other"]);
    expect(result.stale.map((entry) => entry.id)).toEqual(["old"]);
  });

  it("sender aldri en annen brukers oppføringer", () => {
    const result = newestPerReport(
      [
        item({ id: "mine", userId: "u1" }),
        item({ id: "theirs", userId: "u2", createdAt: 2 }),
      ],
      "u1",
    );
    expect(result.ordered.map((entry) => entry.id)).toEqual(["mine"]);
    expect(result.stale).toEqual([]);
  });
});

describe("outbox retry-policy", () => {
  it("avviser payload over API-rutens grense", () => {
    expect(payloadByteLength("æøå")).toBe(6);
    expect(isPayloadWithinLimit("a".repeat(MAX_OUTBOX_PAYLOAD_BYTES))).toBe(
      true,
    );
    expect(
      isPayloadWithinLimit("a".repeat(MAX_OUTBOX_PAYLOAD_BYTES + 1)),
    ).toBe(false);
  });

  it("øker backoffen og stopper ved maks antall forsøk", () => {
    expect(retryDelayMs(1)).toBe(15_000);
    expect(retryDelayMs(2)).toBe(30_000);
    expect(retryDelayMs(3)).toBe(60_000);
    expect(retryDelayMs(100)).toBe(30 * 60_000);
    expect(isAttemptLimitReached(MAX_OUTBOX_ATTEMPTS - 1)).toBe(false);
    expect(isAttemptLimitReached(MAX_OUTBOX_ATTEMPTS)).toBe(true);
  });

  it("hopper over terminale og ventende oppføringer", () => {
    const now = 1_000_000;
    expect(isOutboxTerminal(item({ failedAt: 1 }))).toBe(true);
    expect(isOutboxReady(item({ nextAttemptAt: now + 1 }), now)).toBe(false);
    expect(isOutboxReady(item({ nextAttemptAt: now }), now)).toBe(true);
    expect(isOutboxReady(item({ failedAt: 1 }), now)).toBe(false);
  });
});
