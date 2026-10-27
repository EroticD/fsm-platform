import { beforeEach, describe, expect, it } from "vitest";
import {
  acquireRealtimeSlot,
  deliverRealtimeKind,
  MAX_SSE_PER_IP,
  MAX_SSE_PER_USER,
  realtimeSubscriberCount,
  releaseRealtimeSlot,
  resetRealtimeHubForTests,
  subscribeRealtime,
} from "./realtime-hub";

beforeEach(() => {
  resetRealtimeHubForTests();
});

describe("sanntidsgrenser", () => {
  it("tillater maks tre samtidige strømmer per bruker", () => {
    const slot = { userId: "u1" };
    for (let i = 0; i < MAX_SSE_PER_USER; i += 1) {
      expect(acquireRealtimeSlot(slot)).toBe(true);
    }
    expect(acquireRealtimeSlot(slot)).toBe(false);
  });

  it("tillater maks tre samtidige strømmer per IP", () => {
    for (let i = 0; i < MAX_SSE_PER_IP; i += 1) {
      expect(acquireRealtimeSlot({ userId: `u${i}`, ip: "1.2.3.4" })).toBe(true);
    }
    expect(acquireRealtimeSlot({ userId: "u9", ip: "1.2.3.4" })).toBe(false);
  });

  it("frigir plassen uten å telle under null", () => {
    const slot = { userId: "u1", ip: "1.2.3.4" };
    expect(acquireRealtimeSlot(slot)).toBe(true);
    releaseRealtimeSlot(slot);
    releaseRealtimeSlot(slot);
    for (let i = 0; i < MAX_SSE_PER_USER; i += 1) {
      expect(acquireRealtimeSlot(slot)).toBe(true);
    }
  });
});

describe("in-memory fan-out", () => {
  it("sender kategori til alle abonnenter og avregistrerer rent", () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = ""; // ikke koble til Postgres i testen
    try {
      const received: string[] = [];
      const unsubscribeA = subscribeRealtime((kind) => received.push(`a:${kind}`));
      const unsubscribeB = subscribeRealtime((kind) => received.push(`b:${kind}`));

      expect(realtimeSubscriberCount()).toBe(2);
      deliverRealtimeKind("workorders");

      expect(received).toEqual(["a:workorders", "b:workorders"]);

      unsubscribeA();
      unsubscribeB();
      expect(realtimeSubscriberCount()).toBe(0);
    } finally {
      process.env.DATABASE_URL = original;
    }
  });
});
