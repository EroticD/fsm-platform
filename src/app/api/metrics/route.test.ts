import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = {
  time: "2026-11-02T00:00:00.000Z",
  ok: true,
  ready: true,
  database: "up" as const,
  uploads: "writable" as const,
  disk: { totalBytes: 100, freeBytes: 40, usedRatio: 0.6 },
  queue: {
    documentPending: 1,
    documentFailed: 2,
    smsDeadLetter: 3,
    smsFailed: 4,
    notificationEmailFailed: 5,
  },
  backup: { available: true, ageSeconds: 3600, fresh: true, maxAgeSeconds: 93600 },
  process: { uptimeSeconds: 120, pid: 42 },
};

vi.mock("@/lib/metrics", () => ({
  collectMetrics: vi.fn(async () => snapshot),
  serializePrometheus: vi.fn(() => "fsm_up 1\n"),
}));

import { GET } from "./route";

const originalSecret = process.env.METRICS_SECRET;

beforeEach(() => {
  process.env.METRICS_SECRET = "metrics-secret";
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.METRICS_SECRET;
  else process.env.METRICS_SECRET = originalSecret;
});

describe("/api/metrics", () => {
  it("er deaktivert uten METRICS_SECRET", async () => {
    delete process.env.METRICS_SECRET;
    const response = await GET(new Request("http://localhost:3000/api/metrics"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "metrics_disabled",
    });
  });

  it("avviser manglende og feil bearer", async () => {
    const missing = await GET(new Request("http://localhost:3000/api/metrics"));
    expect(missing.status).toBe(401);
    const wrong = await GET(
      new Request("http://localhost:3000/api/metrics", {
        headers: { authorization: "Bearer feil" },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("returnerer JSON med no-store for gyldig bearer", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/metrics", {
        headers: { authorization: "Bearer metrics-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ready: true,
      queue: { documentFailed: 2, smsDeadLetter: 3 },
      backup: { fresh: true },
    });
  });

  it("returnerer Prometheus-format", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/metrics?format=prometheus", {
        headers: { authorization: "Bearer metrics-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toContain("fsm_up 1");
  });
});
