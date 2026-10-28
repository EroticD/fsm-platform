import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireRealtimeSlot,
  deliverRealtimeKind,
  DEFAULT_MAX_SSE_PER_IP,
  DEFAULT_MAX_SSE_PER_USER,
  MAX_SSE_PER_IP_CAP,
  MAX_SSE_PER_USER_CAP,
  realtimeLimits,
  realtimeSubscriberCount,
  releaseRealtimeSlot,
  resetRealtimeHubForTests,
  subscribeRealtime,
} from "./realtime-hub";

const ORIGINAL_USER = process.env.REALTIME_MAX_SSE_PER_USER;
const ORIGINAL_IP = process.env.REALTIME_MAX_SSE_PER_IP;

beforeEach(() => {
  resetRealtimeHubForTests();
  delete process.env.REALTIME_MAX_SSE_PER_USER;
  delete process.env.REALTIME_MAX_SSE_PER_IP;
});

afterEach(() => {
  if (ORIGINAL_USER === undefined) delete process.env.REALTIME_MAX_SSE_PER_USER;
  else process.env.REALTIME_MAX_SSE_PER_USER = ORIGINAL_USER;
  if (ORIGINAL_IP === undefined) delete process.env.REALTIME_MAX_SSE_PER_IP;
  else process.env.REALTIME_MAX_SSE_PER_IP = ORIGINAL_IP;
});

describe("sanntidsgrenser", () => {
  it("har romslige standardgrenser, men fortsatt et sikkerhetstak", () => {
    expect(DEFAULT_MAX_SSE_PER_USER).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_MAX_SSE_PER_IP).toBeGreaterThanOrEqual(DEFAULT_MAX_SSE_PER_USER);
    expect(MAX_SSE_PER_USER_CAP).toBeGreaterThanOrEqual(DEFAULT_MAX_SSE_PER_USER);
    expect(MAX_SSE_PER_IP_CAP).toBeGreaterThanOrEqual(DEFAULT_MAX_SSE_PER_IP);
  });

  it("tillater standard antall strømmer per bruker", () => {
    const slot = { userId: "u1" };
    for (let i = 0; i < DEFAULT_MAX_SSE_PER_USER; i += 1) {
      expect(acquireRealtimeSlot(slot)).toBe(true);
    }
    expect(acquireRealtimeSlot(slot)).toBe(false);
  });

  it("tillater standard antall strømmer per IP", () => {
    for (let i = 0; i < DEFAULT_MAX_SSE_PER_IP; i += 1) {
      expect(acquireRealtimeSlot({ userId: `u${i}`, ip: "1.2.3.4" })).toBe(true);
    }
    expect(acquireRealtimeSlot({ userId: "u9", ip: "1.2.3.4" })).toBe(false);
  });

  it("leser konfigurerbare grenser fra miljøet", () => {
    process.env.REALTIME_MAX_SSE_PER_USER = "2";
    process.env.REALTIME_MAX_SSE_PER_IP = "3";
    const slot = { userId: "u1", ip: "5.6.7.8" };
    expect(acquireRealtimeSlot(slot)).toBe(true);
    expect(acquireRealtimeSlot(slot)).toBe(true);
    expect(acquireRealtimeSlot(slot)).toBe(false);
  });

  it("klemmer ugyldige og farlig høye miljøverdier", () => {
    process.env.REALTIME_MAX_SSE_PER_USER = "9999";
    process.env.REALTIME_MAX_SSE_PER_IP = "-4";
    const limits = realtimeLimits();
    expect(limits.perUser).toBe(MAX_SSE_PER_USER_CAP);
    expect(limits.perIp).toBe(DEFAULT_MAX_SSE_PER_IP);
  });

  it("frigir plassen uten å telle under null", () => {
    const slot = { userId: "u1", ip: "1.2.3.4" };
    expect(acquireRealtimeSlot(slot)).toBe(true);
    releaseRealtimeSlot(slot);
    releaseRealtimeSlot(slot);
    for (let i = 0; i < DEFAULT_MAX_SSE_PER_USER; i += 1) {
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
